const { spawn } = require('child_process');
const path = require('path');

const ffmpegProcesses = {};

function getFFmpegArgs(video, rtmpUrl, streamKey, looping, duration) {
  const inputFile = path.resolve(__dirname, 'videos', video);
  let args = [
    '-re', // realtime
    ...(looping ? ['-stream_loop', '-1'] : []),
    ...(duration > 0 ? ['-t', duration.toString()] : []),
    '-i', inputFile,
    '-c:v', 'copy',
    '-c:a', 'copy',
    '-f', 'flv',
    '-loglevel', 'quiet',
    `${rtmpUrl}/${streamKey}`
  ];
  return args;
}

function startFFmpeg(id, video, rtmpUrl, streamKey, looping, duration) {
  if (ffmpegProcesses[id]) return;
  const args = getFFmpegArgs(video, rtmpUrl, streamKey, looping, duration);
  const proc = spawn('ffmpeg', args);

  ffmpegProcesses[id] = proc;

  proc.stdout.on('data', data => {
    console.log(`[ffmpeg ${id}] ${data}`);
  });
  proc.stderr.on('data', data => {
    console.log(`[ffmpeg ${id} ERROR] ${data}`);
  });
  proc.on('close', code => {
    console.log(`[ffmpeg ${id}] exited with code ${code}`);
    delete ffmpegProcesses[id];
  });
}

function stopFFmpeg(id) {
  const proc = ffmpegProcesses[id];
  if (proc) {
    proc.kill('SIGTERM');
    delete ffmpegProcesses[id];
  }
}

function getFFmpegStatus(id) {
  return ffmpegProcesses[id] ? 'running' : 'stopped';
}

module.exports = { startFFmpeg, stopFFmpeg, getFFmpegStatus };