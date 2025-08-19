// MAGICA PROJECT - AUTODOWN YOUTUBE

const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { create } = require('youtube-dl-exec');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ytDlpPath = path.join(__dirname, '..', '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');
const ytDlp = create(ytDlpPath, { shell: false, ffmpegLocation: ffmpegPath });
const CACHE = path.join(__dirname, 'cache');
fs.ensureDirSync(CACHE);

const audioOnlyReactions = new Map();

function convertHMS(sec) {
  sec = Number(sec);
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = Math.floor(sec % 60);
  return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function cleanup(filePath) { setTimeout(() => fs.unlink(filePath).catch(() => {}), 30000); }

// CHỈ clean playlist, giữ nguyên dạng link shorts, music, embed, youtu.be
function cleanYouTubeUrl(url) {
  try {
    const urlObj = new URL(url.startsWith('http') ? url : 'https://' + url);
    const domain = urlObj.hostname.toLowerCase();
    const path = urlObj.pathname;
    // youtu.be/VIDEO_ID => https://www.youtube.com/watch?v=VIDEO_ID
    if (domain === 'youtu.be') {
      const videoId = path.split('/')[1]?.substring(0, 11);
      if (videoId && videoId.length === 11) return `https://www.youtube.com/watch?v=${videoId}`;
      return url;
    }
    // youtube.com/embed/VIDEO_ID => https://www.youtube.com/watch?v=VIDEO_ID
    if (path.includes('/embed/')) {
      const match = path.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
      if (match) return `https://www.youtube.com/watch?v=${match[1]}`;
      return url;
    }
    // youtube.com/shorts/VIDEO_ID => giữ nguyên
    if (path.includes('/shorts/')) {
      const match = path.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (match) return `https://www.youtube.com/shorts/${match[1]}`;
      return url;
    }
    // music.youtube.com/watch?v=VIDEO_ID => giữ nguyên, chỉ clean playlist
    if (domain === 'music.youtube.com' && urlObj.searchParams.get('v')) {
      const videoId = urlObj.searchParams.get('v').substring(0, 11);
      return `https://music.youtube.com/watch?v=${videoId}`;
    }
    // youtube.com/watch?v=VIDEO_ID => clean playlist
    if (urlObj.searchParams.get('v')) {
      const videoId = urlObj.searchParams.get('v').substring(0, 11);
      return `https://www.youtube.com/watch?v=${videoId}`;
    }
    return url;
  } catch {
    return url;
  }
}

// Nhận diện chuẩn từng loại link
function isYouTubeMusic(url) {
  return /^https:\/\/music\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})$/.test(url);
}
function isYouTubeShorts(url) {
  return /^https:\/\/www\.youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})$/.test(url);
}
function isYouTubeDownloadableUrl(url) {
  const cleanUrl = cleanYouTubeUrl(url);
  return (
    /^https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})$/.test(cleanUrl) ||
    /^https:\/\/music\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})$/.test(cleanUrl) ||
    /^https:\/\/www\.youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})$/.test(cleanUrl)
  );
}

async function downloadVideoAndInfo(url) {
  const timestart = Date.now();
  const info = await ytDlp(url, { dumpSingleJson: true });
  const duration = info.duration || 0;
  if (duration > 600) {
    const error = new Error('Video quá dài, skip');
    error.shouldReact = true;
    throw error;
  }
  const outputPath = path.join(CACHE, `${info.id}.mp4`);
  const smartFormats = [
    'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]',
    'bestvideo+bestaudio/best',
    'best[ext=mp4]',
    'best'
  ];
  let downloadSuccess = false;
  let usedFormat = '';
  for (const formatString of smartFormats) {
    try {
      await ytDlp(url, {
        format: formatString,
        output: outputPath,
        ffmpegLocation: ffmpegPath,
        mergeOutputFormat: 'mp4',
        noWarnings: true
      });
      if (fs.existsSync(outputPath)) {
        downloadSuccess = true;
        usedFormat = formatString;
        const stats = fs.statSync(outputPath);
        if (stats.size > 26214400) {
          fs.unlinkSync(outputPath);
          throw new Error(`⚠️ Video thực tế ${(stats.size/1048576).toFixed(2)}MB, vượt quá 25MB!`);
        }
        break;
      }
    } catch (formatErr) {
      if (formatErr.message.includes('vượt quá')) throw formatErr;
      continue;
    }
  }
  if (!downloadSuccess) throw new Error('All formats failed');
  return {
    title: info.title,
    dur: info.duration,
    author: info.uploader || info.uploader_id || 'YouTube Channel',
    viewCount: info.view_count || 0,
    likes: info.like_count || 0,
    thumbnail: info.thumbnail,
    timestart,
    id: info.id,
    filePath: outputPath,
    type: 'video',
    usedFormat: usedFormat
  };
}

async function downloadMusicAndInfo(url) {
  const timestart = Date.now();
  const info = await ytDlp(url, { dumpSingleJson: true });
  const duration = info.duration || 0;
  if (duration > 1200) {
    const error = new Error('Audio quá dài, skip');
    error.shouldReact = true;
    throw error;
  }
  const outputPath = path.join(CACHE, `${info.id}.m4a`);
  await ytDlp(url, {
    extractAudio: true,
    audioFormat: 'm4a',
    audioQuality: 0,
    output: outputPath,
    ffmpegLocation: ffmpegPath
  });
  if (fs.existsSync(outputPath)) {
    const stats = fs.statSync(outputPath);
    if (stats.size > 26214400) {
      fs.unlinkSync(outputPath);
      throw new Error(`⚠️ Audio thực tế ${(stats.size/1048576).toFixed(2)}MB, vượt quá 25MB!`);
    }
  }
  return {
    title: info.title,
    dur: info.duration,
    author: info.uploader || info.uploader_id || 'YouTube Channel',
    viewCount: info.view_count || 0,
    likes: info.like_count || 0,
    thumbnail: info.thumbnail,
    timestart,
    id: info.id,
    filePath: outputPath,
    type: 'audio'
  };
}

async function getVideoInfo(url) {
  return await ytDlp(url, { dumpSingleJson: true });
}

async function sendVideoWithMetadata(api, data, threadID, messageID) {
  const timeUsed = Math.floor((Date.now() - data.timestart) / 1000);
  const stats = fs.statSync(data.filePath);
  const fileSizeMB = (stats.size / 1048576).toFixed(2);
  let msg = `> AUTODOWN: YouTube Video

📝 ${data.title}
📺 Kênh: ${data.author}
⏰ Thời lượng: ${convertHMS(data.dur)}
👁️ View: ${data.viewCount.toLocaleString()}
👍 Like: ${data.likes.toLocaleString()}
📦 Kích thước: ${fileSizeMB} MB
⏱️ Xử lý trong: ${timeUsed} giây`;
  const sendVideoWithRetry = (retryCount = 0) => {
    if (!fs.existsSync(data.filePath)) return;
    api.sendMessage({
      body: msg,
      attachment: fs.createReadStream(data.filePath)
    }, threadID, (err) => {
      if (err) {
        if (retryCount < 2) {
          setTimeout(() => sendVideoWithRetry(retryCount + 1), 5000);
        } else {
          api.sendMessage("⚠️ Không thể gửi video do lỗi kết nối!", threadID);
          cleanup(data.filePath);
        }
      } else {
        cleanup(data.filePath);
      }
    }, messageID);
  };
  setTimeout(sendVideoWithRetry, 3000);
}

async function sendAudioWithMetadata(api, data, threadID, messageID) {
  const timeUsed = Math.floor((Date.now() - data.timestart) / 1000);
  const stats = fs.statSync(data.filePath);
  const fileSizeMB = (stats.size / 1048576).toFixed(2);
  let attachment = null;
  const thumbPath = path.join(CACHE, `${data.id}-thumb.jpg`);
  try {
    const res = await axios.get(data.thumbnail, { responseType: 'stream' });
    const writer = fs.createWriteStream(thumbPath);
    await new Promise((resolve, reject) => {
      res.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    attachment = fs.createReadStream(thumbPath);
  } catch (e) {}
  api.sendMessage({
    body: `> AUTODOWN: YouTube Audio

🎵 ${data.title}
📺 Kênh: ${data.author}
⏰ Thời lượng: ${convertHMS(data.dur)}
👁️ View: ${data.viewCount.toLocaleString()}
👍 Like: ${data.likes.toLocaleString()}
📦 Kích thước: ${fileSizeMB} MB
⏱️ Xử lý trong: ${timeUsed} giây`,
    attachment
  }, threadID, async () => {
    if (fs.existsSync(thumbPath)) {
      try { fs.unlinkSync(thumbPath); } catch {}
    }
  }, messageID);
  setTimeout(() => {
    if (!fs.existsSync(data.filePath)) {
      return api.sendMessage("⚠️ Lỗi: File audio không tồn tại!", threadID);
    }
    api.sendMessage({
      attachment: fs.createReadStream(data.filePath)
    }, threadID, (err) => {
      if (!err) {
        cleanup(data.filePath);
      } else {
        setTimeout(() => {
          api.sendMessage({
            attachment: fs.createReadStream(data.filePath)
          }, threadID, (retryErr) => {
            if (!retryErr) {
              cleanup(data.filePath);
            } else {
              api.sendMessage("⚠️ Không thể gửi file audio. Vui lòng thử lại!", threadID);
            }
          });
        }, 2000);
      }
    });
  }, 3000);
}

module.exports.config = {
  name: "autodown",
  version: "9.0",
  hasPermssion: 0,
  credits: "Doniac",
  description: "Tự động tải video và âm thanh từ YouTube",
  commandCategory: "noprefix",
  usages: "",
  cooldowns: 0
};

module.exports.handleReply = async function({ api, event, handleReply }) {
  if (!handleReply || event.messageReply?.messageID !== handleReply.choiceMessageID) return;
  const choice = event.body.trim();
  if (!/^[12]$/.test(choice)) {
    return api.sendMessage("❌ Lựa chọn không hợp lệ! Vui lòng chọn số 1 (âm thanh) hoặc 2 (video).", event.threadID, event.messageID);
  }
  api.setMessageReaction("⏳", event.messageID, () => {}, true);
  try {
    let data;
    if (choice === "1") {
      data = await downloadMusicAndInfo(handleReply.url);
      await sendAudioWithMetadata(api, data, event.threadID, event.messageID);
    } else {
      data = await downloadVideoAndInfo(handleReply.url);
      if (!data || !fs.existsSync(data.filePath)) return;
      await sendVideoWithMetadata(api, data, event.threadID, event.messageID);
    }
    api.setMessageReaction("✅", event.messageID, () => {}, true);
    if (handleReply.choiceMessageID) {
      api.unsendMessage(handleReply.choiceMessageID);
    }
  } catch (err) {
    api.setMessageReaction("❌", event.messageID, () => {}, true);
    if (err.shouldReact) return;
    if (err.message.includes('vượt quá')) {
      api.sendMessage(err.message, event.threadID, event.messageID);
    } else {
      api.sendMessage("⚠️ Đã xảy ra lỗi khi xử lý lựa chọn!", event.threadID, event.messageID);
    }
    if (handleReply.choiceMessageID) {
      api.unsendMessage(handleReply.choiceMessageID);
    }
  }
};

module.exports.handleReaction = async function({ api, event, handleReaction }) {
  if (!handleReaction || !audioOnlyReactions.has(handleReaction.messageID)) return;
  const reactionData = audioOnlyReactions.get(handleReaction.messageID);
  audioOnlyReactions.delete(handleReaction.messageID);
  try {
    api.setMessageReaction("🎵", reactionData.originalMessageID, () => {}, true);
    api.setMessageReaction("⏳", handleReaction.messageID, () => {}, true);
    const data = await downloadMusicAndInfo(reactionData.url);
    await sendAudioWithMetadata(api, data, event.threadID, reactionData.originalMessageID);
    api.setMessageReaction("✅", handleReaction.messageID, () => {}, true);
    setTimeout(() => {
      api.unsendMessage(handleReaction.messageID);
    }, 30000);
  } catch (err) {
    api.setMessageReaction("❌", handleReaction.messageID, () => {}, true);
    if (err.shouldReact) return;
    if (err.message.includes('vượt quá')) {
      api.sendMessage(err.message, event.threadID, reactionData.originalMessageID);
    } else {
      api.sendMessage("⚠️ Đã xảy ra lỗi khi xử lý audio!", event.threadID, reactionData.originalMessageID);
    }
    setTimeout(() => {
      api.unsendMessage(handleReaction.messageID);
    }, 5000);
  }
};

module.exports.handleEvent = async function({ api, event }) {
  const urlRegex = /(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/[^\s]+/gi;
  const match = event.body?.match(urlRegex);
  if (!match) return;
  const originalUrl = match[0];
  const cleanUrl = cleanYouTubeUrl(originalUrl);
  if (!isYouTubeDownloadableUrl(cleanUrl)) return;

  try {
    if (isYouTubeMusic(cleanUrl)) {
      api.setMessageReaction("⏳", event.messageID, () => {}, true);
      const info = await ytDlp(cleanUrl, { dumpSingleJson: true });
      if ((info.duration || 0) > 1200) {
        api.setMessageReaction("❌", event.messageID, () => {}, true);
        return;
      }
      const data = await downloadMusicAndInfo(cleanUrl);
      await sendAudioWithMetadata(api, data, event.threadID, event.messageID);
      api.setMessageReaction("✅", event.messageID, () => {}, true);
      return;
    }

    if (isYouTubeShorts(cleanUrl)) {
      api.setMessageReaction("⏳", event.messageID, () => {}, true);
      const data = await downloadVideoAndInfo(cleanUrl);
      await sendVideoWithMetadata(api, data, event.threadID, event.messageID);
      api.setMessageReaction("✅", event.messageID, () => {}, true);
      return;
    }

    const info = await getVideoInfo(cleanUrl);
    const duration = info.duration || 0;

    if (duration > 1200) {
      api.setMessageReaction("❌", event.messageID, () => {}, true);
      return;
    }

    if (duration > 600) {
      let thumbnailAttachment = null;
      const tempThumbPath = path.join(CACHE, `temp_thumb_${Date.now()}.jpg`);
      try {
        const res = await axios.get(info.thumbnail, { responseType: 'stream' });
        const writer = fs.createWriteStream(tempThumbPath);
        await new Promise((resolve, reject) => {
          res.data.pipe(writer);
          writer.on('finish', resolve);
          writer.on('error', reject);
        });
        thumbnailAttachment = fs.createReadStream(tempThumbPath);
      } catch {}

      api.sendMessage({
        body: `📹 Video dài ${convertHMS(duration)} đã được phát hiện!

🎵 ${info.title}
📺 Kênh: ${info.uploader}
👁️ View: ${(info.view_count || 0).toLocaleString()}
👍 Like: ${(info.like_count || 0).toLocaleString()}

⚠️ Video quá dài để tải xuống, cậu chỉ có thể tải âm thanh.
👆 Hãy thả emoji bất kì vào tin nhắn này để tải âm thanh nhé!`,
        attachment: thumbnailAttachment
      }, event.threadID, (err, messageInfo) => {
        if (fs.existsSync(tempThumbPath)) {
          try { fs.unlinkSync(tempThumbPath); } catch {}
        }
        if (!err) {
          api.setMessageReaction("🎵", event.messageID, () => {}, true); // chỉ react âm nhạc vào tin nhắn gốc
          audioOnlyReactions.set(messageInfo.messageID, {
            url: cleanUrl,
            info: info,
            originalMessageID: event.messageID
          });
          global.client.handleReaction.push({
            name: this.config.name,
            messageID: messageInfo.messageID,
            url: cleanUrl
          });
        }
      }, event.messageID);
      return;
    }

    let thumbnailAttachment = null;
    const tempThumbPath = path.join(CACHE, `temp_thumb_${Date.now()}.jpg`);
    try {
      const res = await axios.get(info.thumbnail, { responseType: 'stream' });
      const writer = fs.createWriteStream(tempThumbPath);
      await new Promise((resolve, reject) => {
        res.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
      thumbnailAttachment = fs.createReadStream(tempThumbPath);
    } catch {}

    api.sendMessage({
      body: `📹 Video ${duration < 300 ? 'ngắn' : 'dài'} ${convertHMS(duration)} đã được phát hiện!

📝 ${info.title}
📺 Kênh: ${info.uploader}
👁️ View: ${(info.view_count || 0).toLocaleString()}
👍 Like: ${(info.like_count || 0).toLocaleString()}

> Cậu muốn tải theo dạng nào?
1️⃣ Âm thanh (.mp3; .m4a)
2️⃣ Video (.mp4)
> Hãy reply theo số 1 hoặc 2 nhé:`,
      attachment: thumbnailAttachment
    }, event.threadID, (err, messageInfo) => {
      if (fs.existsSync(tempThumbPath)) {
        try { fs.unlinkSync(tempThumbPath); } catch {}
      }
      if (!err) {
        api.setMessageReaction("⏳", messageInfo.messageID, () => {}, true); // react đồng hồ cát vào tin nhắn hỏi 1/2
        api.setMessageReaction("❓", event.messageID, () => {}, true); // react dấu hỏi vào tin nhắn gốc
        global.client.handleReply.push({
          name: this.config.name,
          messageID: messageInfo.messageID,
          choiceMessageID: messageInfo.messageID,
          url: cleanUrl
        });
      }
    }, event.messageID);
  } catch (err) {
    api.setMessageReaction("❌", event.messageID, () => {}, true);
    if (err.shouldReact) return;
    if (err.message.includes('vượt quá')) {
      api.sendMessage(err.message, event.threadID, event.messageID);
    } else {
      api.sendMessage("⚠️ Đã xảy ra lỗi khi xử lý link YouTube!", event.threadID, event.messageID);
    }
  }
};

module.exports.onLoad = () => {
  if (!global.client.handleReply) global.client.handleReply = [];
  if (!global.client.handleReaction) global.client.handleReaction = [];
  audioOnlyReactions.clear();
};

module.exports.run = () => {};
