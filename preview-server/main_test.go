package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
)

func TestHealth(t *testing.T) {
	response := httptest.NewRecorder()
	(&server{}).health(response, httptest.NewRequest(http.MethodGet, "/health", nil))
	if response.Code != http.StatusOK || response.Body.String() != `{"status":"ok"}` {
		t.Fatalf("unexpected health response: %d %q", response.Code, response.Body.String())
	}
}

func TestChartForSong(t *testing.T) {
	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if _, err := database.Exec(`
		CREATE TABLE songs (id TEXT, audio_path TEXT);
		CREATE TABLE charts (id TEXT, song_id TEXT, chart_path TEXT);
		INSERT INTO songs VALUES ('song', 'charts/a song/audio.ogg');
		INSERT INTO charts VALUES ('chart', 'song', 'charts/a song/chart [hard].osu');
	`); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/api/charts/song/song", nil)
	request.SetPathValue("songID", "song")
	response := httptest.NewRecorder()
	(&server{db: database}).chartForSong(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("unexpected chart response: %d %q", response.Code, response.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["audio_url"] != "/charts/a%20song/audio.ogg" || body["chart_url"] != "/charts/a%20song/chart%20%5Bhard%5D.osu" {
		t.Fatalf("unexpected chart URLs: %#v", body)
	}
}

func TestAssetURL(t *testing.T) {
	if actual := assetURL("charts/song/audio #1.ogg"); actual != "/charts/song/audio%20%231.ogg" {
		t.Fatalf("unexpected asset URL: %s", actual)
	}
	if _, err := url.Parse(assetURL("charts/song/audio.ogg")); err != nil {
		t.Fatal(err)
	}
}

func TestSelectPreviewRejectsUnknownChart(t *testing.T) {
	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if _, err := database.Exec(`
		CREATE TABLE songs (id TEXT, audio_path TEXT, preview_seconds REAL);
		CREATE TABLE charts (id TEXT, song_id TEXT);
	`); err != nil {
		t.Fatal(err)
	}
	session := &previewSession{server: &server{db: database}}
	if err := session.selectPreview("missing", 0); err == nil {
		t.Fatal("expected an unknown chart error")
	}
}

func TestSelectPreviewRejectsPathOutsidePublicDirectory(t *testing.T) {
	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if _, err := database.Exec(`
		CREATE TABLE songs (id TEXT, audio_path TEXT, preview_seconds REAL);
		CREATE TABLE charts (id TEXT, song_id TEXT);
		INSERT INTO songs VALUES ('song', '../outside.ogg', 0);
		INSERT INTO charts VALUES ('chart', 'song');
	`); err != nil {
		t.Fatal(err)
	}
	session := &previewSession{server: &server{
		config: config{publicPath: t.TempDir()},
		db:     database,
	}}
	if err := session.selectPreview("chart", 0); err == nil {
		t.Fatal("expected an outside-public-directory error")
	}
}

func TestPreviewSessionStreamsAudio(t *testing.T) {
	testPreviewSessionStreamsAudio(t, "SELECT id FROM charts ORDER BY id LIMIT 1", 1)
}

func TestPreviewSessionRepairsIrregularSourceTimestamps(t *testing.T) {
	testPreviewSessionStreamsAudio(t, "SELECT id FROM charts WHERE song_id = '2277451' LIMIT 1", 20)
}

func TestPreviewSessionStreamsAiDrew(t *testing.T) {
	testPreviewSessionStreamsAudio(t, "SELECT id FROM charts WHERE song_id = '2200770' LIMIT 1", 20)
}

func TestPreviewSessionStreamsAreaOfEffect(t *testing.T) {
	testPreviewSessionStreamsAudio(t, "SELECT id FROM charts WHERE song_id = '2323413' LIMIT 1", 20)
}

func TestPreviewSessionKeepsRTPContinuousWhenSwitching(t *testing.T) {
	testPreviewSessionStreamsAudio(
		t,
		"SELECT id FROM charts WHERE song_id = '2200770' LIMIT 1",
		20,
		"SELECT id FROM charts WHERE song_id = '2323413' LIMIT 1",
		"SELECT id FROM charts WHERE song_id = '2200770' LIMIT 1",
		"SELECT id FROM charts WHERE song_id = '2323413' LIMIT 1",
		"SELECT id FROM charts WHERE song_id = '2200770' LIMIT 1",
	)
}

func testPreviewSessionStreamsAudio(t *testing.T, chartQuery string, packetCount int, switchQueries ...string) {
	t.Helper()
	root, err := filepath.Abs("..")
	if err != nil {
		t.Fatal(err)
	}
	database, err := sql.Open("sqlite3", "file:"+filepath.Join(root, "server/catalog.sqlite")+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	var chartID string
	if err := database.QueryRow(chartQuery).Scan(&chartID); err != nil {
		t.Fatal(err)
	}
	chartIDs := []string{chartID}
	for _, query := range switchQueries {
		if err := database.QueryRow(query).Scan(&chartID); err != nil {
			t.Fatal(err)
		}
		chartIDs = append(chartIDs, chartID)
	}

	app := &server{config: config{publicPath: filepath.Join(root, "public"), ffmpegPath: "ffmpeg"}, db: database}
	serverConnection, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	track, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{
		MimeType:  webrtc.MimeTypeOpus,
		ClockRate: 48000,
		Channels:  2,
	}, "preview-audio", "rizu-preview")
	if err != nil {
		t.Fatal(err)
	}
	sender, err := serverConnection.AddTrack(track)
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		buffer := make([]byte, 1500)
		for {
			if _, _, err := sender.Read(buffer); err != nil {
				return
			}
		}
	}()
	session := &previewSession{server: app, connection: serverConnection, track: track}
	serverConnection.OnDataChannel(session.onDataChannel)
	defer session.close()

	clientConnection, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer clientConnection.Close()
	if _, err := clientConnection.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio, webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionRecvonly}); err != nil {
		t.Fatal(err)
	}
	channel, err := clientConnection.CreateDataChannel("preview-control", nil)
	if err != nil {
		t.Fatal(err)
	}
	opened := make(chan struct{})
	channel.OnOpen(func() { close(opened) })
	receivedAudio := make(chan error, 1)
	batchReceived := make(chan struct{}, len(chartIDs)-1)
	clientConnection.OnTrack(func(remote *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		var previousTimestamp uint32
		var previousSequence uint16
		for index := 0; index < packetCount*len(chartIDs); index++ {
			packet, _, err := remote.ReadRTP()
			if err != nil {
				receivedAudio <- err
				return
			}
			timestampStep := packet.Timestamp - previousTimestamp
			if index > 0 && (timestampStep < 959 || timestampStep > 961) {
				receivedAudio <- fmt.Errorf("unexpected RTP timestamp step: %d", timestampStep)
				return
			}
			if index > 0 && packet.SequenceNumber != previousSequence+1 {
				receivedAudio <- fmt.Errorf("unexpected RTP sequence step: %d to %d", previousSequence, packet.SequenceNumber)
				return
			}
			previousTimestamp = packet.Timestamp
			previousSequence = packet.SequenceNumber
			if (index+1)%packetCount == 0 && index+1 < packetCount*len(chartIDs) {
				batchReceived <- struct{}{}
			}
		}
		receivedAudio <- nil
	})

	offer, err := clientConnection.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := clientConnection.SetLocalDescription(offer); err != nil {
		t.Fatal(err)
	}
	<-webrtc.GatheringCompletePromise(clientConnection)
	if err := serverConnection.SetRemoteDescription(*clientConnection.LocalDescription()); err != nil {
		t.Fatal(err)
	}
	answer, err := serverConnection.CreateAnswer(nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := serverConnection.SetLocalDescription(answer); err != nil {
		t.Fatal(err)
	}
	<-webrtc.GatheringCompletePromise(serverConnection)
	if err := clientConnection.SetRemoteDescription(*serverConnection.LocalDescription()); err != nil {
		t.Fatal(err)
	}

	context, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	select {
	case <-opened:
	case <-context.Done():
		t.Fatal("data channel did not open")
	}
	for index, selectedChartID := range chartIDs {
		if index > 0 {
			select {
			case <-batchReceived:
			case <-context.Done():
				t.Fatal("preview audio batch was not received before switching")
			}
		}
		command, _ := json.Marshal(previewCommand{Type: "select_preview", RequestID: int64(index + 1), ChartID: selectedChartID})
		if err := channel.Send(command); err != nil {
			t.Fatal(err)
		}
	}
	select {
	case err := <-receivedAudio:
		if err != nil {
			t.Fatal(err)
		}
	case <-context.Done():
		t.Fatal("preview audio was not received")
	}
}
