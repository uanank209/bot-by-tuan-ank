// MAGICA PROJECT - AUTODOWN INSTAGRAM

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

function cleanup(filePaths) {
  setTimeout(() => {
    filePaths.forEach(filePath => {
      fs.unlink(filePath).catch(() => {});
    });
  }, 30000);
}

function isInstagramDownloadableUrl(url) {
  try {
    const urlObj = new URL(url.startsWith('http') ? url : 'https://' + url);
    const domain = urlObj.hostname.toLowerCase();
    const path = urlObj.pathname.toLowerCase();
    
    if (!['instagram.com', 'www.instagram.com', 'm.instagram.com', 'instagr.am'].includes(domain)) {
      return false;
    }
    
    if (path.includes('/p/') && path.split('/').length >= 3) {
      return true;
    }
    
    if (path.includes('/reel/') && path.split('/').length >= 3) {
      return true;
    }
    
    if ((path.includes('/tv/') || path.includes('/igtv/')) && path.split('/').length >= 3) {
      return true;
    }
    
    if (path === '/' ||
        path === '' ||
        path.includes('/explore/') ||
        path.includes('/stories/') ||
        path.includes('/accounts/') ||
        path.includes('/direct/') ||
        path.includes('/tagged/') ||
        path.includes('/saved/') ||
        path.includes('/following/') ||
        path.includes('/followers/') ||
        path.split('/').length === 2) {
      return false;
    }
    
    return false;
    
  } catch (err) {
    return false;
  }
}

async function downloadInstagramVideo(url) {
  const timestart = Date.now();

  const defaultUserAgent = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
  const defaultFormat = "bestvideo[height>=1080]+bestaudio/best[height>=1080]";
  
  const defaultHeaders = [
    `User-Agent:${defaultUserAgent}`,
    'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language:en-US,en;q=0.9',
    'Accept-Encoding:gzip, deflate, br',
    'DNT:1',
    'Connection:keep-alive',
    'Upgrade-Insecure-Requests:1',
    'sec-ch-ua:"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'sec-ch-ua-mobile:?1',
    'sec-ch-ua-platform:"Android"',
    'Viewport-Width:393',
    'Device-Memory:8'
  ];

  const info = await ytDlp(url, {
    dumpSingleJson: true,
    noCheckCertificates: true,
    noWarnings: true,
    preferFreeFormats: true,
    forceIpv4: true,
    userAgent: defaultUserAgent,
    addHeader: defaultHeaders
  });

  // FIX: Check duration trực tiếp thay vì checkEstimatedSize
  const isCarousel = info._type === 'playlist' && info.entries && info.entries.length > 0;
  const entries = isCarousel ? info.entries : [info];
  
  let videoCount = 0;
  let totalDuration = 0;
  
  for (const entry of entries) {
    const isVideo = (entry.duration && entry.duration > 0) || 
                   url.includes('/reel/') || url.includes('/tv/') || url.includes('/igtv/');
    
    if (!isVideo) {
      continue;
    }
    
    videoCount++;
    const duration = entry.duration || 0;
    totalDuration += duration;
  }
  
  if (videoCount === 0) {
    throw new Error('NO_VIDEO_CONTENT');
  }
  
  // FIX: Duration check - dưới 10p thì tải, trên 10p skip
  if (totalDuration > 600) {
    const error = new Error('Video quá dài, skip');
    error.shouldReact = true;
    throw error;
  }
  
  // FIX: Check carousel items limit
  if (videoCount > 10) {
    const error = new Error('Quá nhiều items, skip');
    error.shouldReact = true;
    throw error;
  }

  const files = [];
  let totalSize = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    
    const isVideo = (entry.duration && entry.duration > 0) || 
                   url.includes('/reel/') || url.includes('/tv/') || url.includes('/igtv/');
    
    if (!isVideo) {
      continue;
    }

    const outputPath = path.join(CACHE, `ig_${info.id}_${i + 1}.mp4`);

    try {
      await ytDlp(isCarousel ? entry.url : url, {
        format: defaultFormat,
        output: outputPath,
        ffmpegLocation: ffmpegPath,
        forceIpv4: true,
        userAgent: defaultUserAgent,
        addHeader: defaultHeaders,
        preferFreeFormats: true,
        mergeOutputFormat: 'mp4',
        noWarnings: true
      });

      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        totalSize += stats.size;
        
        files.push({
          path: outputPath,
          type: 'video',
          size: stats.size,
          index: i + 1
        });
        
        // FIX: 25MB limit per file
        if (stats.size > 26214400) {
          fs.unlinkSync(outputPath);
          files.pop();
          totalSize -= stats.size;
        }
      } else {
        const fallbackFormats = ['best[ext=mp4]', 'best'];
        
        for (const fallbackFormat of fallbackFormats) {
          try {
            await ytDlp(isCarousel ? entry.url : url, {
              format: fallbackFormat,
              output: outputPath,
              ffmpegLocation: ffmpegPath,
              forceIpv4: true,
              userAgent: defaultUserAgent,
              addHeader: defaultHeaders,
              preferFreeFormats: true,
              mergeOutputFormat: 'mp4',
              noWarnings: true
            });

            if (fs.existsSync(outputPath)) {
              const stats = fs.statSync(outputPath);
              
              // FIX: 25MB limit per file
              if (stats.size > 26214400) {
                fs.unlinkSync(outputPath);
                continue;
              }
              
              totalSize += stats.size;
              
              files.push({
                path: outputPath,
                type: 'video',
                size: stats.size,
                index: i + 1
              });
              
              break;
            }
          } catch (fallbackErr) {
            // Fallback failed
          }
        }
      }
    } catch (itemErr) {
      // Item failed
    }
  }

  if (files.length === 0) {
    throw new Error('NO_VIDEO_CONTENT');
  }

  // FIX: 25MB total limit
  if (totalSize > 26214400) {
    files.forEach(file => fs.unlinkSync(file.path));
    throw new Error(`⚠️ Instagram tổng dung lượng ${(totalSize/1048576).toFixed(2)}MB, vượt quá 25MB limit!`);
  }

  return {
    engine: 'yt-dlp-optimized',
    title: info.title || 'Instagram Video',
    description: info.description || '',
    dur: info.duration || 0,
    author: info.uploader || info.uploader_id || 'Instagram User',
    viewCount: info.view_count || 0,
    likes: info.like_count || 0,
    comments: info.comment_count || 0,
    timestart,
    id: info.id,
    files: files,
    totalSize: totalSize,
    isCarousel: isCarousel,
    mediaCount: files.length
  };
}

module.exports.config = {
  name: "igdl",
  version: "11.4-complete-validation",
  hasPermssion: 0,
  credits: "Doniac",
  description: "Tải video từ Instagram tự động",
  commandCategory: "noprefix",
  usages: "",
  cooldowns: 0
};

module.exports.handleEvent = async function({ api, event }) {
  const urlRegex = /(https?:\/\/)?(www\.|m\.)?(instagram\.com|instagr\.am)\/(p|reel|tv|igtv)\/[A-Za-z0-9_-]+/gi;
  const match = event.body?.match(urlRegex);
  if (!match) return;

  const url = match[0];
  
  if (!isInstagramDownloadableUrl(url)) {
    return;
  }
  
  let reactionSet = false;

  try {
    api.setMessageReaction("⏳", event.messageID, () => {}, true);
    reactionSet = true;

    const data = await downloadInstagramVideo(url);
    
    if (!data || !data.files || data.files.length === 0) {
      api.setMessageReaction("", event.messageID, () => {}, true);
      return;
    }

    const totalSizeMB = (data.totalSize / 1048576).toFixed(2);
    const timeUsed = Math.floor((Date.now() - data.timestart) / 1000);

    let msg = '> AUTODOWN: Instagram Video\n\n';
    
    if (data.description) {
      msg += `📝 ${data.description}\n`;
    }

    if (data.dur > 0) {
      msg += `👤 Người đăng: ${data.author}\n`;
    }
    
    msg += `⏰ Thời lượng: ${convertHMS(data.dur)}\n`;
    
    if (data.viewCount > 0) {
      msg += `👁️ Lượt xem: ${data.viewCount.toLocaleString()}\n`;
    }
    
    if (data.likes > 0) {
      msg += `👍 Lượt thích: ${data.likes.toLocaleString()}\n`;
    }
    
    if (data.comments > 0) {
      msg += `💬 Bình luận: ${data.comments.toLocaleString()}\n`;
    }
    
    if (data.mediaCount > 1) {
      msg += `🎬 Video: ${data.mediaCount} files\n`;
    }
    
    msg += `📦 Kích thước: ${totalSizeMB} MB\n`;
    msg += `⏱️ Xử lý trong: ${timeUsed} giây`;

    const attachments = data.files
      .sort((a, b) => a.index - b.index)
      .map(file => fs.createReadStream(file.path));

    api.setMessageReaction("✅", event.messageID, () => {}, true);

    api.sendMessage({
      body: msg,
      attachment: attachments
    }, event.threadID, err => {
      if (!err) {
        cleanup(data.files.map(f => f.path));
      }
    }, event.messageID);

  } catch (err) {
    if (err.message.includes('There is no video') || 
        err.message.includes('NO_VIDEO_CONTENT') ||
        err.message.includes('private') ||
        err.message.includes('login') ||
        err.message.includes('not available') ||
        err.message.includes('age-restricted') ||
        err.message.includes('This content isn\'t available right now')) {
      
      if (reactionSet) {
        api.setMessageReaction("", event.messageID, () => {}, true);
      }
      return;
    }
    
    if (reactionSet) {
      api.setMessageReaction("❌", event.messageID, () => {}, true);
    }
    
    // FIX: Duration/items limit - chỉ react X, không gửi message
    if (err.shouldReact) {
      return;
    }
    
    if (err.message.includes('vượt quá')) {
      api.sendMessage(err.message, event.threadID, event.messageID);
    }
  }
};

module.exports.run = () => {};
