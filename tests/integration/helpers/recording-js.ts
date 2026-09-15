/**
 * 页面侧录音探针。
 *
 * 与 `transcription-service.ts` 里注入的脚本是同一套做法
 * （只留音轨、不传 mimeType / timeslice），
 * 单独放一份用于「浏览器到底能不能录」这条前置断言。
 */
export const RECORDING_DRAIN_TEST_JS = `(async () => {
  const video = document.querySelector('video');
  if (!video) return -1;
  const stream = video.captureStream();
  const audioOnly = new MediaStream(stream.getAudioTracks());
  if (audioOnly.getAudioTracks().length === 0) return -2;

  const recorder = new MediaRecorder(audioOnly);
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.start();
  await new Promise((r) => setTimeout(r, 1500));
  await new Promise((resolve) => { recorder.onstop = resolve; recorder.stop(); });

  return chunks.reduce((sum, blob) => sum + blob.size, 0);
})()`
