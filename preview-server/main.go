package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

type config struct {
	address     string
	catalogPath string
	publicPath  string
	ffmpegPath  string
	udpAddress  string
	publicIP    string
}

type server struct {
	config config
	db     *sql.DB
	api    *webrtc.API
}

type signalRequest struct {
	SDP  string         `json:"sdp"`
	Type webrtc.SDPType `json:"type"`
}

type previewCommand struct {
	Type         string  `json:"type"`
	RequestID    int64   `json:"requestId"`
	ChartID      string  `json:"chartId"`
	StartSeconds float64 `json:"startSeconds"`
}

type previewResponse struct {
	Type      string `json:"type"`
	RequestID int64  `json:"requestId"`
	Message   string `json:"message,omitempty"`
}

type previewSession struct {
	server       *server
	connection   *webrtc.PeerConnection
	track        *webrtc.TrackLocalStaticRTP
	mu           sync.Mutex
	cancelSource context.CancelFunc
	sourceID     uint64
	sequence     uint16
	timestamp    uint32
	hasPacket    bool
	closeOnce    sync.Once
}

func main() {
	var cfg config
	flag.StringVar(&cfg.address, "address", "127.0.0.1:8090", "HTTP signaling address")
	flag.StringVar(&cfg.catalogPath, "catalog", "../server/catalog.sqlite", "server catalog database")
	flag.StringVar(&cfg.publicPath, "public", "../public", "public asset directory")
	flag.StringVar(&cfg.ffmpegPath, "ffmpeg", "ffmpeg", "FFmpeg executable")
	flag.StringVar(&cfg.udpAddress, "udp-address", ":50000", "WebRTC UDP listen address")
	flag.StringVar(&cfg.publicIP, "public-ip", "", "public IP advertised in ICE candidates")
	flag.Parse()

	database, err := sql.Open("sqlite3", "file:"+cfg.catalogPath+"?mode=ro")
	if err != nil {
		log.Fatal(err)
	}
	defer database.Close()
	if err := database.Ping(); err != nil {
		log.Fatal(err)
	}

	udpAddress, err := net.ResolveUDPAddr("udp4", cfg.udpAddress)
	if err != nil {
		log.Fatal(err)
	}
	udpConnection, err := net.ListenUDP("udp4", udpAddress)
	if err != nil {
		log.Fatal(err)
	}
	defer udpConnection.Close()
	settingEngine := webrtc.SettingEngine{}
	settingEngine.SetICEUDPMux(webrtc.NewICEUDPMux(nil, udpConnection))
	if cfg.publicIP != "" {
		settingEngine.SetNAT1To1IPs([]string{cfg.publicIP}, webrtc.ICECandidateTypeHost)
	}

	app := &server{config: cfg, db: database, api: webrtc.NewAPI(webrtc.WithSettingEngine(settingEngine))}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", app.health)
	mux.HandleFunc("GET /api/charts/song/{songID}", app.chartForSong)
	mux.HandleFunc("POST /api/preview/offer", app.offer)
	log.Printf("preview server listening on http://%s", cfg.address)
	log.Printf("WebRTC listening on UDP %s", cfg.udpAddress)
	log.Fatal(http.ListenAndServe(cfg.address, mux))
}

func (s *server) health(response http.ResponseWriter, _ *http.Request) {
	response.Header().Set("Content-Type", "application/json")
	_, _ = io.WriteString(response, `{"status":"ok"}`)
}

func (s *server) chartForSong(response http.ResponseWriter, request *http.Request) {
	var audioPath string
	var chartPath string
	err := s.db.QueryRow(`
		SELECT songs.audio_path, charts.chart_path
		FROM charts
		JOIN songs ON songs.id = charts.song_id
		WHERE songs.id = ?
		ORDER BY charts.id
		LIMIT 1
	`, request.PathValue("songID")).Scan(&audioPath, &chartPath)
	if errors.Is(err, sql.ErrNoRows) {
		http.Error(response, "selected song was not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(response, "failed to query selected song", http.StatusInternalServerError)
		return
	}
	response.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(response).Encode(map[string]string{
		"audio_url": assetURL(audioPath),
		"chart_url": assetURL(chartPath),
	})
}

func assetURL(assetPath string) string {
	parts := strings.Split(filepath.ToSlash(assetPath), "/")
	for index, part := range parts {
		parts[index] = url.PathEscape(part)
	}
	return "/" + strings.Join(parts, "/")
}

func (s *server) offer(response http.ResponseWriter, request *http.Request) {
	var offer signalRequest
	if err := json.NewDecoder(http.MaxBytesReader(response, request.Body, 1<<20)).Decode(&offer); err != nil {
		http.Error(response, "invalid SDP offer", http.StatusBadRequest)
		return
	}
	if offer.Type != webrtc.SDPTypeOffer || offer.SDP == "" {
		http.Error(response, "an SDP offer is required", http.StatusBadRequest)
		return
	}

	connection, err := s.api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		http.Error(response, "failed to create peer connection", http.StatusInternalServerError)
		return
	}
	track, err := webrtc.NewTrackLocalStaticRTP(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2},
		"preview-audio",
		"rizu-preview",
	)
	if err != nil {
		_ = connection.Close()
		http.Error(response, "failed to create audio track", http.StatusInternalServerError)
		return
	}
	sender, err := connection.AddTrack(track)
	if err != nil {
		_ = connection.Close()
		http.Error(response, "failed to add audio track", http.StatusInternalServerError)
		return
	}
	go func() {
		buffer := make([]byte, 1500)
		for {
			if _, _, err := sender.Read(buffer); err != nil {
				return
			}
		}
	}()

	session := &previewSession{server: s, connection: connection, track: track}
	connection.OnDataChannel(session.onDataChannel)
	connection.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		if state == webrtc.PeerConnectionStateFailed || state == webrtc.PeerConnectionStateClosed || state == webrtc.PeerConnectionStateDisconnected {
			session.close()
		}
	})
	if err := connection.SetRemoteDescription(webrtc.SessionDescription{Type: offer.Type, SDP: offer.SDP}); err != nil {
		session.close()
		http.Error(response, "failed to apply SDP offer", http.StatusBadRequest)
		return
	}
	answer, err := connection.CreateAnswer(nil)
	if err != nil {
		session.close()
		http.Error(response, "failed to create SDP answer", http.StatusInternalServerError)
		return
	}
	gatheringComplete := webrtc.GatheringCompletePromise(connection)
	if err := connection.SetLocalDescription(answer); err != nil {
		session.close()
		http.Error(response, "failed to apply SDP answer", http.StatusInternalServerError)
		return
	}
	select {
	case <-gatheringComplete:
	case <-request.Context().Done():
		session.close()
		return
	case <-time.After(10 * time.Second):
		session.close()
		http.Error(response, "ICE gathering timed out", http.StatusGatewayTimeout)
		return
	}

	response.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(response).Encode(connection.LocalDescription()); err != nil {
		session.close()
	}
}

func (s *previewSession) onDataChannel(channel *webrtc.DataChannel) {
	if channel.Label() != "preview-control" {
		return
	}
	channel.OnMessage(func(message webrtc.DataChannelMessage) {
		var command previewCommand
		if err := json.Unmarshal(message.Data, &command); err != nil || command.Type != "select_preview" || command.ChartID == "" {
			s.sendResponse(channel, previewResponse{Type: "preview_error", RequestID: command.RequestID, Message: "invalid preview command"})
			return
		}
		if command.StartSeconds < 0 {
			command.StartSeconds = 0
		}
		if err := s.selectPreview(command.ChartID, command.StartSeconds); err != nil {
			s.sendResponse(channel, previewResponse{Type: "preview_error", RequestID: command.RequestID, Message: err.Error()})
			return
		}
		s.sendResponse(channel, previewResponse{Type: "preview_selected", RequestID: command.RequestID})
	})
}

func (s *previewSession) sendResponse(channel *webrtc.DataChannel, response previewResponse) {
	data, err := json.Marshal(response)
	if err == nil {
		_ = channel.Send(data)
	}
}

func (s *previewSession) selectPreview(chartID string, startSeconds float64) error {
	var audioPath string
	var previewSeconds float64
	err := s.server.db.QueryRow(`
		SELECT songs.audio_path, songs.preview_seconds
		FROM charts
		JOIN songs ON songs.id = charts.song_id
		WHERE charts.id = ?
	`, chartID).Scan(&audioPath, &previewSeconds)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("chart %s was not found", chartID)
	}
	if err != nil {
		return fmt.Errorf("query chart: %w", err)
	}
	if startSeconds == 0 {
		startSeconds = previewSeconds
	}

	assetPath := filepath.Join(s.server.config.publicPath, filepath.FromSlash(audioPath))
	publicRoot, err := filepath.Abs(s.server.config.publicPath)
	if err != nil {
		return err
	}
	assetPath, err = filepath.Abs(assetPath)
	if err != nil {
		return err
	}
	if relative, err := filepath.Rel(publicRoot, assetPath); err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		return errors.New("catalog audio path is outside the public directory")
	}
	if _, err := os.Stat(assetPath); err != nil {
		return fmt.Errorf("open preview audio: %w", err)
	}

	s.mu.Lock()
	if s.cancelSource != nil {
		s.cancelSource()
	}
	s.sourceID++
	sourceID := s.sourceID
	context, cancel := context.WithCancel(context.Background())
	s.cancelSource = cancel
	s.mu.Unlock()
	go s.stream(context, sourceID, assetPath, startSeconds)
	return nil
}

func (s *previewSession) stream(ctx context.Context, sourceID uint64, assetPath string, startSeconds float64) {
	listener, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.ParseIP("127.0.0.1")})
	if err != nil {
		log.Printf("listen for FFmpeg RTP: %v", err)
		return
	}
	defer listener.Close()
	port := listener.LocalAddr().(*net.UDPAddr).Port
	command := exec.CommandContext(ctx, s.server.config.ffmpegPath,
		"-loglevel", "error",
		"-re", "-ss", fmt.Sprintf("%.3f", startSeconds),
		"-i", assetPath,
		"-vn", "-af", "asetpts=N/SR/TB", "-ac", "2", "-ar", "48000",
		"-c:a", "libopus", "-application", "audio", "-b:a", "64k", "-vbr", "constrained",
		"-packet_loss:a", "10", "-fec:a", "1", "-frame_duration:a", "20",
		"-payload_type", "111", "-f", "rtp", fmt.Sprintf("rtp://127.0.0.1:%d?pkt_size=1200", port),
	)
	command.Stderr = os.Stderr
	if err := command.Start(); err != nil {
		log.Printf("start FFmpeg: %v", err)
		return
	}
	processDone := make(chan error, 1)
	go func() {
		processDone <- command.Wait()
		_ = listener.Close()
	}()
	buffer := make([]byte, 1500)
	firstPacket := true
	for {
		bytesRead, _, err := listener.ReadFromUDP(buffer)
		if err != nil {
			break
		}
		var packet rtp.Packet
		if err := packet.Unmarshal(buffer[:bytesRead]); err != nil {
			log.Printf("parse FFmpeg RTP packet: %v", err)
			continue
		}
		s.mu.Lock()
		if sourceID != s.sourceID {
			s.mu.Unlock()
			continue
		}
		if s.hasPacket {
			s.sequence++
			s.timestamp += 960
		} else {
			s.sequence = packet.SequenceNumber
			s.timestamp = packet.Timestamp
			s.hasPacket = true
		}
		packet.SequenceNumber = s.sequence
		packet.Timestamp = s.timestamp
		packet.Marker = firstPacket
		firstPacket = false
		s.mu.Unlock()
		if err := s.track.WriteRTP(&packet); err != nil {
			_ = command.Process.Kill()
			break
		}
	}
	if err := <-processDone; err != nil && ctx.Err() == nil {
		log.Printf("FFmpeg preview failed: %v", err)
	}
}

func (s *previewSession) close() {
	s.closeOnce.Do(func() {
		s.mu.Lock()
		if s.cancelSource != nil {
			s.cancelSource()
			s.cancelSource = nil
		}
		s.mu.Unlock()
		_ = s.connection.Close()
	})
}
