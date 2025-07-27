async function updateStats() {
  const videosRes = await fetch('/api/videos');
  const videos = await videosRes.json();
  document.getElementById('totalVideos').textContent = videos.length;

  const streamsRes = await fetch('/api/streams');
  const streams = await streamsRes.json();
  const active = streams.filter(s => s.status === 'running').length;
  document.getElementById('activeStreams').textContent = active;
  document.getElementById('inactiveStreams').textContent = streams.length - active;
}

async function renderVideoList() {
    const res = await fetch('/api/videos');
    const videos = await res.json();
    const videoList = document.getElementById('videoList');
    videoList.innerHTML = '';
    if (videos.length === 0) {
      videoList.innerHTML = '<div class="col">Belum ada video.</div>';
      return;
    }
    videos.forEach(v => {
      const card = document.createElement('div');
      card.className = 'col-md-3 mb-3';
      card.innerHTML = `
        <div class="card">
          <video src="/videos/${v}" class="card-img-top" controls style="max-height:160px"></video>
          <div class="card-body">
            <h6 class="card-title text-break">${v}</h6>
            <div class="input-group input-group-sm mb-2">
              <input type="text" class="form-control" placeholder="Rename ke..." value="${v.replace('.mp4','')}" id="rename-${v}">
              <button class="btn btn-outline-secondary" onclick="renameVideo('${v}')">Rename</button>
            </div>
            <button class="btn btn-danger btn-sm w-100" onclick="deleteVideo('${v}')">Hapus</button>
          </div>
        </div>
      `;
      videoList.appendChild(card);
    });
  }
  
  async function deleteVideo(filename) {
    if (!confirm(`Hapus video ${filename}?`)) return;
    const res = await fetch(`/api/videos/${filename}`, { method: 'DELETE' });
    if (res.ok) {
      alert('Video dihapus!');
      renderVideoList();
      fetchVideos();
      updateStats();
    } else {
      alert('Gagal menghapus video');
    }
  }
  
  async function renameVideo(filename) {
    const input = document.getElementById(`rename-${filename}`);
    let newName = input.value.trim().replace(/[^a-zA-Z0-9_\-\.\ ]/g, '') + '.mp4';
    if (newName === filename) return alert('Nama baru sama dengan nama lama!');
    const res = await fetch(`/api/videos/${filename}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ newName })
    });
    if (res.ok) {
      alert('Video berhasil di-rename!');
      renderVideoList();
      fetchVideos();
      updateStats();
    } else {
      const result = await res.json();
      alert('Rename gagal: ' + (result.error || res.statusText));
    }
  }
  
  // Panggil saat load

  ///////////////////////////////////////

async function fetchVideos() {
    const res = await fetch('/api/videos');
    const videos = await res.json();
    const select = document.getElementById('videoSelect');
    select.innerHTML = "";
    videos.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    });
}

async function fetchStreams() {
    const res = await fetch('/api/streams');
    const streams = await res.json();
    renderTable(streams);
}

function renderTable(streams) {
    const tbody = document.querySelector('#streamsTable tbody');
    tbody.innerHTML = "";
    streams.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${s.title}</td>
        <td>${s.video}</td>
        <td>${s.rtmp_url}</td>
        <td>${s.stream_key}</td>
        <td>${s.looping ? "Ya" : "Tidak"}</td>
        <td>${s.duration || 0}</td>
        <td>${s.status || 'stopped'}</td>
        <td>
          <button class="btn btn-success btn-sm" onclick="startStream(${s.id})" ${s.status === 'running' ? 'disabled' : ''}>Start</button>
          <button class="btn btn-warning btn-sm" onclick="stopStream(${s.id})" ${s.status !== 'running' ? 'disabled' : ''}>Stop</button>
          <button class="btn btn-info btn-sm" onclick="editStream(${s.id})">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteStream(${s.id})">Hapus</button>
          <button class="btn btn-secondary btn-sm" onclick="showFFmpeg(${s.id})">FFmpeg</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
}

document.getElementById('streamForm').onsubmit = async function(e) {
    e.preventDefault();
    const data = {
      title: document.getElementById('title').value,
      video: document.getElementById('videoSelect').value,
      rtmp_url: document.getElementById('rtmpUrl').value,
      stream_key: document.getElementById('streamKey').value,
      looping: document.getElementById('looping').checked,
      duration: parseInt(document.getElementById('duration').value) || 0
    };
    if(window.editingId) {
      await fetch(`/api/streams/${window.editingId}`, {
        method: 'PUT', headers: {'Content-Type':'application/json'},
        body: JSON.stringify(data)
      });
      window.editingId = null;
    } else {
      await fetch('/api/streams', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify(data)
      });
    }

    const modalEl = document.getElementById('streamModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    modal.hide();
    this.reset();
    await fetchStreams();
    await updateStats();
};

async function startStream(id) {
    await fetch(`/api/streams/${id}/start`, { method: 'POST' });
    await fetchStreams();
    await updateStats();
}
async function stopStream(id) {
    await fetch(`/api/streams/${id}/stop`, { method: 'POST' });
    await fetchStreams();
    await updateStats();
}
async function deleteStream(id) {
    if(!confirm('Hapus stream ini?')) return;
    await fetch(`/api/streams/${id}`, { method: 'DELETE' });
    await fetchStreams();
    await updateStats();
}
async function editStream(id) {
    const res = await fetch('/api/streams');
    const streams = await res.json();
    const s = streams.find(item => item.id === id);
    if(!s) return;
    document.getElementById('title').value = s.title;
    document.getElementById('videoSelect').value = s.video;
    document.getElementById('rtmpUrl').value = s.rtmp_url;
    document.getElementById('streamKey').value = s.stream_key;
    document.getElementById('looping').checked = !!s.looping;
    document.getElementById('duration').value = s.duration || 0;
    window.editingId = id;

  const streamModal = new bootstrap.Modal(document.getElementById('streamModal'));
  streamModal.show();
}

async function showFFmpeg(id) {
    const res = await fetch('/api/streams');
    const streams = await res.json();
    const s = streams.find(item => item.id === id);
    if(!s) return;
    let args = [
      '-re',
      ...(s.looping ? ['-stream_loop', '-1'] : []),
      ...(s.duration > 0 ? ['-t', s.duration.toString()] : []),
      '-i', `videos/${s.video}`,
      '-c:v', 'copy',
      '-c:a', 'copy',
      '-f', 'flv',
      '-loglevel', 'quiet',
      `${s.rtmp_url}/${s.stream_key}`
    ];
    document.getElementById('ffmpegCommand').textContent = `ffmpeg ${args.join(' ')}`;
    // Show Bootstrap modal
    const modal = new bootstrap.Modal(document.getElementById('ffmpegConfigModal'));
    modal.show();
}

window.editingId = null;

document.getElementById('closeModal').onclick = function() {
    const modal = bootstrap.Modal.getInstance(document.getElementById('ffmpegConfigModal'));
    modal.hide();
};

window.onclick = function(event) {
    // Bootstrap modal handles this
};

// ========== Video Upload (Direct) ==========
document.getElementById('uploadForm').onsubmit = function(e) {
    e.preventDefault();
    const fileInput = document.getElementById('videoFile');
    const file = fileInput.files[0];
    if(!file) return alert('Pilih file video terlebih dahulu!');
    const formData = new FormData();
    formData.append('video', file);

    const progressBar = document.getElementById('uploadProgressBar');
    const progressContainer = document.getElementById('uploadProgressContainer');
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';
    progressBar.textContent = '0%';

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/videos/upload');
    xhr.upload.onprogress = function(e) {
        if(e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            progressBar.style.width = percent + '%';
            progressBar.textContent = percent + '%';
        }
    };
    xhr.onload = function() {
        progressContainer.style.display = 'none';
        if(xhr.status === 200) {
            fetchVideos();
            renderVideoList();
            updateStats();
            fileInput.value = '';
            alert('Upload berhasil!');
        } else {
            alert('Upload gagal: ' + xhr.responseText);
        }
    };
    xhr.onerror = function() {
        progressContainer.style.display = 'none';
        alert('Upload gagal');
    };
    xhr.send(formData);
};

// ========== Google Drive Import ==========
document.getElementById('driveForm').onsubmit = async function(e) {
    e.preventDefault();
    const urlInput = document.getElementById('driveUrl');
    const url = urlInput.value.trim();
    if(!url) return alert('URL Google Drive belum diisi');
    const progressBar = document.getElementById('uploadProgressBar');
    const progressContainer = document.getElementById('uploadProgressContainer');
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';
    progressBar.textContent = 'Mengimpor...';

    try {
        const res = await fetch('/api/videos/drive', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ url })
        });
        const result = await res.json();
        progressContainer.style.display = 'none';
        if(res.ok) {
            urlInput.value = '';
            fetchVideos();
            renderVideoList();
            updateStats();
            alert('Impor dari Drive berhasil!');
        } else {
            alert('Impor gagal: ' + (result.error || res.statusText));
        }
    } catch (err) {
        progressContainer.style.display = 'none';
        alert('Impor gagal!');
    }
};

// Initial load
fetchVideos();
renderVideoList();
fetchStreams();
updateStats();