export interface GameplayRenderStats {
  readonly draw_calls: number;
  readonly command_count: number;
  readonly vertex_count: number;
  readonly buffer_upload_count: number;
  readonly slider_pass_count: number;
}
