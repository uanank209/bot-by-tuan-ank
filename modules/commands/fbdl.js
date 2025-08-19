// MAGICA PROJECT - AUTODOWN FACEBOOK

const fs = require('fs-extra');
const path = require('path');
const { create } = require('youtube-dl-exec');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

const ytDlpPath = path.join(__dirname, '..', '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');
const ytDlp = create(ytDlpPath, {
  shell: false,
  ffmpegLocation: ffmpegPath
});

const CACHE = path.join(__dirname, 'cache');
fs.ensureDirSync(CACHE);

function convertHMS(sec) {
  sec = Number(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor(sec % 3600 / 60);
  const s = Math.floor(sec % 60);
  return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function cleanup(filePath) {
  setTimeout(() => fs.unlink(filePath).catch(() => {}), 30000);
}

function isFacebookVideoUrl(url) {
  const videoPatterns = [
    /facebook\.com\/(watch\/\?v=\d+)/i,
    /facebook\.com\/.*\/videos\/\d+/i,
    /facebook\.com\/reel\//i,
    /facebook\.com\/story\.php.*video/i,
    /fb\.watch\//i,
    /fbcdn.*\.mp4/i,
    /facebook\.com\/.*\/video\//i,
    /facebook\.com\/.*\/posts\/.*/i,
    /facebook\.com\/share\/r\/.*/i,
    /facebook\.com\/share\/v\/.*/i
  ];
  
  return videoPatterns.some(pattern => pattern.test(url));
}

async function downloadVideoAndInfo(url) {
  const timestart = Date.now();
  const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  try {
    const info = await ytDlp(url, {
      dumpSingleJson: true,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      forceIpv4: true,
      userAgent: userAgent
    });

    // FIX: Check duration - dưới 10p thì tải, trên 10p skip
    const duration = info.duration || 0;
    if (duration > 600) {
      const error = new Error('Video quá dài, skip');
      error.shouldReact = true;
      throw error;
    }

    const outputPath = path.join(CACHE, `fb_${info.id}.mp4`);

    const facebookFormats = [
      'bestvideo+bestaudio/best',
      'best[ext=mp4][height<=720]',
      'best[ext=mp4]',
      'best'
    ];

    let downloadSuccess = false;
    let usedFormat = '';

    for (const formatString of facebookFormats) {
      try {
        await ytDlp(url, {
          format: formatString,
          output: outputPath,
          ffmpegLocation: ffmpegPath,
          forceIpv4: true,
          userAgent: userAgent,
          preferFreeFormats: true,
          mergeOutputFormat: 'mp4',
          noWarnings: true
        });

        if (fs.existsSync(outputPath)) {
          downloadSuccess = true;
          usedFormat = formatString;
          
          const stats = fs.statSync(outputPath);
          const actualMB = stats.size / 1048576;
          
          // FIX: 25MB limit thay vì 100MB
          if (stats.size > 26214400) {
            fs.unlinkSync(outputPath);
            throw new Error(`⚠️ Facebook video thực tế ${actualMB.toFixed(2)}MB, vượt quá 25MB!`);
          }
          
          break;
        }
      } catch (formatErr) {
        if (formatErr.message.includes('vượt quá')) {
          throw formatErr;
        }
        continue;
      }
    }

    if (!downloadSuccess) {
      throw new Error('All Facebook formats failed');
    }

    return {
      title: info.title || 'Facebook Video',
      description: info.description || '',
      dur: info.duration || 0,
      comments: info.comment_count || 0,
      shares: info.repost_count || 0,
      uploadDate: info.upload_date || '',
      timestart,
      id: info.id,
      filePath: outputPath,
      usedFormat: usedFormat
    };

  } catch (err) {
    throw err;
  }
}

module.exports.config = {
  name: "fbdl",
  version: "3.3",
  hasPermssion: 0,
  credits: "Doniac",
  description: "Tự động tải video từ Facebook",
  commandCategory: "noprefix",
  usages: "",
  cooldowns: 0
};

module.exports.handleEvent = async function({ api, event }) {
  if (!event.body || event.body.length < 10) {
    return;
  }
  
  const facebookKeywords = ['facebook.com', 'fb.watch', 'fb.me', 'fbcdn.net', 'share/r/', 'share/v/'];
  const hasKeyword = facebookKeywords.some(keyword => 
    event.body.toLowerCase().includes(keyword)
  );
  
  if (!hasKeyword) {
    return;
  }
  
  const urlRegex = /(https?:\/\/)?(www\.|m\.|mbasic\.|mobile\.|touch\.)?(facebook\.com|fb\.me|fb\.watch|fbcdn\.net)\S*/gi;
  const match = event.body?.match(urlRegex);
  
  if (!match) {
    return;
  }

  const url = match[0];

  if (!isFacebookVideoUrl(url)) {
    return;
  }

  let reactionSet = false;
  try {
    api.setMessageReaction("⏳", event.messageID, () => {}, true);
    reactionSet = true;

    const data = await downloadVideoAndInfo(url);
    
    if (!data || !fs.existsSync(data.filePath)) {
      api.setMessageReaction("", event.messageID, () => {}, true);
      return;
    }

    const stats = fs.statSync(data.filePath);
    const fileSizeMB = (stats.size / 1048576).toFixed(2);
    const timeUsed = Math.floor((Date.now() - data.timestart) / 1000);

    let msg = '> AUTODOWN: Facebook Video\n\n';
    
    if (data.title && data.title !== 'Facebook Video') {
      msg += `📝 ${data.title}\n`;
    }
    
    if (data.dur > 0) {
      msg += `⏰ Thời lượng: ${convertHMS(data.dur)}\n`;
    }
    
    if (data.comments > 0) {
      msg += `💬 Bình luận: ${data.comments.toLocaleString()}\n`;
    }
    
    if (data.shares > 0) {
      msg += `🔄 Chia sẻ: ${data.shares.toLocaleString()}\n`;
    }
    
    if (data.uploadDate) {
      const formattedDate = data.uploadDate.replace(/(\d{4})(\d{2})(\d{2})/, '$3/$2/$1');
      msg += `📅 Ngày đăng: ${formattedDate}\n`;
    }
    
    msg += `📦 Kích thước: ${fileSizeMB} MB\n`;
    msg += `⏱️ Xử lý trong: ${timeUsed} giây`;

    api.setMessageReaction("✅", event.messageID, () => {}, true);

    api.sendMessage({
      body: msg,
      attachment: fs.createReadStream(data.filePath)
    }, event.threadID, err => {
      if (!err) {
        cleanup(data.filePath);
      }
    }, event.messageID);

  } catch (err) {
    if (reactionSet) {
      api.setMessageReaction("❌", event.messageID, () => {}, true);
    }
    
    // FIX: Duration limit - chỉ react X, không gửi message
    if (err.shouldReact) {
      return;
    }
    
    if (err.message.includes('vượt quá')) {
      api.sendMessage(err.message, event.threadID, event.messageID);
    } else {
      api.sendMessage("⚠️ Đã xảy ra lỗi khi xử lý video Facebook!", event.threadID, event.messageID);
    }
  }
};

module.exports.run = () => {};
