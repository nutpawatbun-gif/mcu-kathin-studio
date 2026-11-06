'use strict';

const $ = id => document.getElementById(id);
const canvas = $('poster');
const ctx = canvas.getContext('2d', { alpha: false });
const W = 1200;
const H = 1500;
const STORAGE_CURRENT = 'mcu-anumodana-current-v2';
const STORAGE_DRAFTS = 'mcu-anumodana-drafts-v2';

const todayThai = () => new Intl.DateTimeFormat('th-TH', {
  day: 'numeric', month: 'long', year: 'numeric'
}).format(new Date());

const freshState = () => ({
  template: 'classic',
  donor: '',
  amount: '',
  date: todayThai(),
  occasion: 'ในโอกาสร่วมบุญทอดกฐิน',
  blessing: 'ขออำนาจคุณพระศรีรัตนตรัย จงอำนวยพรให้ท่านประสบแต่ความสุข ความเจริญ สุขภาพแข็งแรง และสัมฤทธิผลในสิ่งอันพึงปรารถนาทุกประการ',
  photoData: '',
  photoX: 0,
  photoY: 0,
  zoom: 1,
  noPhoto: false,
  sparkle: 45,
  glow: 55,
  fontFamily: 'sarabun',
  fontScale: 1.1,
  thaiDigits: true
});

let state = freshState();
let currentDraftId = null;
let photoImage = null;
let rafId = 0;
let lastFrame = 0;
let toastTimer = 0;
let autoSaveTimer = 0;
let dragging = null;

const backgroundImage = new Image();
backgroundImage.src = './assets/luxury_buddhist_background_v2.png';
const foregroundImage = new Image();
foregroundImage.src = './assets/ceremonial_offering_foreground_v4.png';
const titleFrameImage = new Image();
titleFrameImage.src = './assets/ornate_thai_title_frame_v2.png';
const portraitFrameImage = new Image();
portraitFrameImage.src = './assets/thai_portrait_frame_v1.png';
const mcuLogoImage = new Image();
mcuLogoImage.src = './assets/mcu_logo.png';

const fontStacks = {
  sarabun: '"MCU Sarabun","Noto Sans Thai",Tahoma,sans-serif',
  tahoma: 'Tahoma,"MCU Sarabun","Noto Sans Thai",sans-serif',
  sans: 'Arial,"MCU Sarabun","Noto Sans Thai",sans-serif'
};

const themes = {
  classic: { ink: '#702269', accent: '#9e318d', gold: '#e1ad3d', pale: '#fff7f3', panel: '#fff8f5' },
  dawn: { ink: '#704724', accent: '#a76542', gold: '#d59a2f', pale: '#fffaf0', panel: '#fffaf2' },
  royal: { ink: '#5b2b57', accent: '#7e3d73', gold: '#d8b56a', pale: '#fffefb', panel: '#fffaf3' }
};

function toast(message) {
  clearTimeout(toastTimer);
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function safeParse(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeState(value) {
  const base = freshState();
  if (!value || typeof value !== 'object') return base;
  const next = { ...base, ...value };
  if (!themes[next.template]) next.template = 'classic';
  next.zoom = Math.min(2.8, Math.max(.8, Number(next.zoom) || 1));
  next.photoX = Math.min(320, Math.max(-320, Number(next.photoX) || 0));
  next.photoY = Math.min(300, Math.max(-300, Number(next.photoY) || 0));
  next.sparkle = Math.min(100, Math.max(0, Number(next.sparkle) || 0));
  next.glow = Math.min(100, Math.max(0, Number(next.glow) || 0));
  return next;
}

function syncForm() {
  ['donor', 'amount', 'zoom', 'photoY', 'sparkle', 'glow', 'fontFamily', 'fontScale'].forEach(id => {
    $(id).value = state[id];
  });
  $('noPhoto').checked = state.noPhoto;
  $('thaiDigits').checked = state.thaiDigits;
  $('zoomValue').value = `${Math.round(state.zoom * 100)}%`;
  $('sparkleValue').value = `${state.sparkle}%`;
  $('glowValue').value = `${state.glow}%`;
  $('photoTools').hidden = !state.photoData;
  document.querySelectorAll('.template-card').forEach(button => {
    const selected = button.dataset.template === state.template;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  canvas.classList.toggle('drag-ready', Boolean(photoImage && !state.noPhoto));
}

function scheduleAutoSave() {
  $('saveState').textContent = 'กำลังบันทึก…';
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_CURRENT, JSON.stringify({ state, currentDraftId }));
      $('saveState').textContent = 'บันทึกอัตโนมัติ';
    } catch {
      $('saveState').textContent = 'พื้นที่จัดเก็บเต็ม';
    }
  }, 450);
}

function setState(patch, options = {}) {
  state = normalizeState({ ...state, ...patch });
  if (options.form !== false) syncForm();
  draw(performance.now() / 1000);
  scheduleAutoSave();
}

function loadPhoto(data) {
  return new Promise(resolve => {
    if (!data) { photoImage = null; resolve(null); return; }
    const image = new Image();
    image.onload = () => { photoImage = image; resolve(image); };
    image.onerror = () => { photoImage = null; resolve(null); };
    image.src = data;
  });
}

function canvasFont(weight, size) {
  const family = fontStacks[state.fontFamily] || fontStacks.sarabun;
  return `${weight} ${Math.round(size * Number(state.fontScale || 1))}px ${family}`;
}

async function ensureCanvasFonts() {
  if (!document.fonts?.load) return;
  const sample = 'การสั่งสมบุญ ขออนุโมทนาบุญ Online Donation 356-2-20222-2';
  try {
    const requests = [400, 500, 600, 700].map(weight => document.fonts.load(`${weight} 48px "MCU Sarabun"`, sample));
    await Promise.all(requests);
    await document.fonts.ready;
  } catch (error) {
    console.warn('Web font could not be preloaded; using a local fallback.', error);
  }
}

function roundedPath(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function roundedRect(x, y, width, height, radius, fill, stroke, lineWidth = 2) {
  roundedPath(x, y, width, height, radius);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
}

function fitText(value, maxWidth, initial, min = 20, weight = '700') {
  const text = String(value || '');
  let size = initial;
  while (size > min) {
    ctx.font = canvasFont(weight, size);
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 1;
  }
  return size;
}

function centerText(value, x, y, maxWidth, size, color, weight = '700', shadow = false) {
  const text = String(value || '');
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  if (shadow) { ctx.shadowColor = 'rgba(40,15,40,.28)'; ctx.shadowBlur = 7; ctx.shadowOffsetY = 2; }
  ctx.font = canvasFont(weight, fitText(text, maxWidth, size, 19, weight));
  ctx.fillText(text, x, y);
  ctx.restore();
}

function wrapText(value, maxWidth, size, maxLines) {
  const text = String(value || '').trim();
  ctx.font = canvasFont('600', size);
  const lines = [];
  let line = '';
  for (const char of text) {
    if (ctx.measureText(line + char).width > maxWidth && line) {
      lines.push(line);
      line = char;
    } else line += char;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let final = lines[maxLines - 1];
    while (ctx.measureText(final + '…').width > maxWidth && final.length) final = final.slice(0, -1);
    lines[maxLines - 1] = final + '…';
  }
  return lines;
}

function drawCover(image, x, y, width, height) {
  if (!image?.naturalWidth) return;
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const dw = image.naturalWidth * scale;
  const dh = image.naturalHeight * scale;
  ctx.drawImage(image, x + (width - dw) / 2, y + (height - dh) / 2, dw, dh);
}

function drawCustomBackground(type) {
  const gradient = ctx.createLinearGradient(0, 0, 0, H);
  if (type === 'dawn') {
    gradient.addColorStop(0, '#f6dfbd');
    gradient.addColorStop(.35, '#fff8e9');
    gradient.addColorStop(.75, '#f8e8df');
    gradient.addColorStop(1, '#f0cf94');
  } else if (type === 'royal') {
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(.28, '#fffefb');
    gradient.addColorStop(.56, '#f8f2e9');
    gradient.addColorStop(.78, '#fffafd');
    gradient.addColorStop(1, '#f3e8dc');
  } else {
    gradient.addColorStop(0, '#21143d');
    gradient.addColorStop(.4, '#4a2259');
    gradient.addColorStop(.75, '#6c315f');
    gradient.addColorStop(1, '#2b173e');
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  for (let i = 0; i < 12; i++) {
    const x = 40 + (i * 137) % 1120;
    const y = 90 + (i * 211) % 830;
    const r = 85 + (i % 4) * 38;
    const cloud = ctx.createRadialGradient(x, y, 0, x, y, r);
    cloud.addColorStop(0, type === 'dawn' ? 'rgba(255,255,255,.38)' : type === 'royal' ? 'rgba(255,255,255,.78)' : 'rgba(213,167,225,.12)');
    cloud.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = cloud;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.translate(W / 2, 470);
  for (let i = 0; i < 22; i++) {
    ctx.rotate(Math.PI * 2 / 22);
    const ray = ctx.createLinearGradient(0, 0, 0, -620);
    ray.addColorStop(0, type === 'dawn' ? 'rgba(236,181,63,.13)' : type === 'royal' ? 'rgba(210,175,102,.085)' : 'rgba(255,213,105,.11)');
    ray.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = ray;
    ctx.beginPath();
    ctx.moveTo(-13, 0); ctx.lineTo(13, 0); ctx.lineTo(72, -620); ctx.lineTo(-72, -620); ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  if (type === 'royal') {
    // Pearl-on-pearl Thai embossing along the margins: visible in the light,
    // quiet enough to preserve the clean ceremonial field in the centre.
    ctx.save();
    [86, 1114].forEach((x, side) => {
      const direction = side === 0 ? 1 : -1;
      for (let y = 245; y <= 1045; y += 200) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(direction, 1);
        ctx.strokeStyle = 'rgba(179,143,76,.12)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -42);
        ctx.bezierCurveTo(4, -20, 28, -18, 34, 0);
        ctx.bezierCurveTo(22, -8, 13, 7, 0, 23);
        ctx.bezierCurveTo(-13, 7, -22, -8, -34, 0);
        ctx.bezierCurveTo(-28, -18, -4, -20, 0, -42);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.88)';
        ctx.lineWidth = 1;
        ctx.translate(-1, -1);
        ctx.stroke();
        ctx.restore();
      }
    });
    ctx.restore();
  }
}

function drawHeader(theme) {
  if (state.template === 'classic') {
    const cover = ctx.createLinearGradient(0, 0, 0, 150);
    cover.addColorStop(0, 'rgba(237,208,245,.18)');
    cover.addColorStop(1, 'rgba(255,239,244,.08)');
    ctx.fillStyle = cover;
    ctx.fillRect(0, 0, W, 150);
  }
  const hasLogo = mcuLogoImage.naturalWidth > 0;
  const textX = hasLogo ? 660 : W / 2;
  if (hasLogo) {
    const logoHeight = 112;
    const logoWidth = logoHeight * mcuLogoImage.naturalWidth / mcuLogoImage.naturalHeight;
    ctx.save();
    ctx.globalAlpha = .98;
    ctx.shadowColor = state.template === 'royal' ? 'rgba(158,116,45,.24)' : 'rgba(255,255,255,.88)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 2;
    ctx.drawImage(mcuLogoImage, 265, 8, logoWidth, logoHeight);
    ctx.restore();
  }
  const color = theme.ink;
  centerText('มหาวิทยาลัยมหาจุฬาลงกรณราชวิทยาลัย', textX, 45, hasLogo ? 820 : 1050, 42, color, '700');
  centerText('วิทยาลัยสงฆ์พ่อขุนผาเมือง เพชรบูรณ์', textX, 96, hasLogo ? 840 : 1060, 45, color, '700');
  if (state.template === 'classic') return;
  const line = ctx.createLinearGradient(140, 0, 1060, 0);
  line.addColorStop(0, 'rgba(221,167,43,0)'); line.addColorStop(.2, theme.gold); line.addColorStop(.8, theme.gold); line.addColorStop(1, 'rgba(221,167,43,0)');
  ctx.fillStyle = line;
  ctx.fillRect(130, 130, 940, 3);
  ctx.fillStyle = theme.gold;
  ctx.save(); ctx.translate(W / 2, 131); ctx.rotate(Math.PI / 4); ctx.fillRect(-8, -8, 16, 16); ctx.restore();
}

function portraitPath() {
  const path = new Path2D();
  path.moveTo(365, 515); path.lineTo(365, 315);
  path.bezierCurveTo(365, 280, 385, 260, 420, 250);
  path.bezierCurveTo(455, 210, 515, 190, 600, 190);
  path.bezierCurveTo(685, 190, 745, 210, 780, 250);
  path.bezierCurveTo(815, 260, 835, 280, 835, 315);
  path.lineTo(835, 515);
  // Follow the real inner gold edge: lower at both shoulders, then rise
  // gently behind the central lotus ornament so the photo never bleeds out.
  path.bezierCurveTo(815, 538, 790, 545, 748, 548);
  path.bezierCurveTo(690, 551, 645, 543, 600, 538);
  path.bezierCurveTo(555, 543, 510, 551, 452, 548);
  path.bezierCurveTo(410, 545, 385, 538, 365, 515);
  path.closePath();
  return path;
}

function drawPortrait(theme) {
  ctx.save();
  ctx.translate(0, 18);
  const path = portraitPath();
  ctx.save();
  ctx.shadowColor = 'rgba(210,157,35,.45)'; ctx.shadowBlur = 28;
  ctx.fillStyle = theme.gold; ctx.fill(path);
  ctx.restore();
  ctx.save();
  ctx.clip(path);
  const inner = ctx.createLinearGradient(0, 160, 0, 720);
  inner.addColorStop(0, state.template === 'royal' ? '#fffefa' : '#fff4d5');
  inner.addColorStop(1, state.template === 'royal' ? '#eadfce' : '#e9c894');
  ctx.fillStyle = inner; ctx.fillRect(330, 145, 540, 440);
  if (photoImage && !state.noPhoto) {
    const frameW = 470, frameH = 355;
    const factor = Math.max(frameW / photoImage.naturalWidth, frameH / photoImage.naturalHeight) * state.zoom;
    const width = photoImage.naturalWidth * factor;
    const height = photoImage.naturalHeight * factor;
    ctx.drawImage(photoImage, W / 2 - width / 2 + state.photoX, 360 - height / 2 + state.photoY, width, height);
  } else {
    const halo = ctx.createRadialGradient(600, 360, 0, 600, 360, 280);
    halo.addColorStop(0, 'rgba(255,255,255,.65)'); halo.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = halo; ctx.fillRect(330, 150, 540, 430);
    centerText('พื้นที่ภาพเจ้าภาพ', 600, 360, 400, 36, state.template === 'royal' ? '#9d7a45' : '#92744e', '500');
  }
  ctx.restore();
  if (portraitFrameImage.naturalWidth) {
    ctx.save();
    ctx.shadowColor = 'rgba(214,166,61,.22)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 3;
    ctx.drawImage(portraitFrameImage, 300, 135, 600, 450);
    ctx.restore();
  } else {
    ctx.save(); ctx.lineWidth = 12; ctx.strokeStyle = theme.gold; ctx.shadowColor = 'rgba(236,190,75,.5)'; ctx.shadowBlur = 16; ctx.stroke(path);
    ctx.shadowBlur = 0; ctx.lineWidth = 3; ctx.strokeStyle = '#fff2bd'; ctx.stroke(path); ctx.restore();
  }
  ctx.restore();
}

function drawOffering() {
  if (!foregroundImage.naturalWidth) return;
  // A wide, shallow arrangement keeps the robe dominant while showing the
  // complete low pedestal and the lotus groups on both sides.
  const width = 920;
  const height = width * foregroundImage.naturalHeight / foregroundImage.naturalWidth;
  ctx.save();
  ctx.globalAlpha = .96;
  ctx.shadowColor = 'rgba(255,213,186,.28)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 4;
  ctx.drawImage(foregroundImage, (W - width) / 2, 600, width, height);
  ctx.restore();
}

function thaiNumber(value) {
  const formatted = Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return state.thaiDigits ? formatted.replace(/[0-9]/g, digit => '๐๑๒๓๔๕๖๗๘๙'[Number(digit)]) : formatted;
}

function thaiBannerPath() {
  const path = new Path2D();
  path.moveTo(235, 970);
  path.lineTo(265, 952);
  path.lineTo(275, 934);
  path.lineTo(300, 934);
  path.quadraticCurveTo(309, 921, 333, 921);
  path.lineTo(867, 921);
  path.quadraticCurveTo(891, 921, 900, 934);
  path.lineTo(925, 934);
  path.lineTo(935, 952);
  path.lineTo(965, 970);
  path.lineTo(935, 988);
  path.lineTo(925, 1006);
  path.lineTo(900, 1006);
  path.quadraticCurveTo(891, 1019, 867, 1019);
  path.lineTo(333, 1019);
  path.quadraticCurveTo(309, 1019, 300, 1006);
  path.lineTo(275, 1006);
  path.lineTo(265, 988);
  path.closePath();
  return path;
}

function thaiBannerInnerPath() {
  const path = new Path2D();
  path.moveTo(250, 970);
  path.lineTo(278, 954);
  path.lineTo(286, 942);
  path.lineTo(306, 942);
  path.quadraticCurveTo(315, 930, 337, 930);
  path.lineTo(863, 930);
  path.quadraticCurveTo(885, 930, 894, 942);
  path.lineTo(914, 942);
  path.lineTo(922, 954);
  path.lineTo(950, 970);
  path.lineTo(922, 986);
  path.lineTo(914, 998);
  path.lineTo(894, 998);
  path.quadraticCurveTo(885, 1010, 863, 1010);
  path.lineTo(337, 1010);
  path.quadraticCurveTo(315, 1010, 306, 998);
  path.lineTo(286, 998);
  path.lineTo(278, 986);
  path.closePath();
  return path;
}

function drawThaiRosette(x, y, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffd86a';
  ctx.strokeStyle = '#fff4b0';
  ctx.lineWidth = 2.3;
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.rotate(i * Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(4, 0);
    ctx.lineTo(14, -10);
    ctx.lineTo(25, 0);
    ctx.lineTo(14, 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#a81d87';
    ctx.beginPath();
    ctx.moveTo(10, 0); ctx.lineTo(15, -5); ctx.lineTo(20, 0); ctx.lineTo(15, 5); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = '#fff1a1';
  ctx.fillRect(-6.5, -6.5, 13, 13);
  ctx.strokeRect(-6.5, -6.5, 13, 13);
  ctx.restore();
}

function drawThaiTitleText() {
  const text = 'ขออนุโมทนาบุญ';
  const size = fitText(text, 505, 72, 52, '700');
  const gold = ctx.createLinearGradient(0, 930, 0, 1005);
  if (state.template === 'royal') {
    gold.addColorStop(0, '#8f4b82');
    gold.addColorStop(.48, '#6f2f65');
    gold.addColorStop(1, '#512349');
  } else {
    gold.addColorStop(0, '#fff3a8');
    gold.addColorStop(.45, '#ffd55c');
    gold.addColorStop(1, '#f1aa25');
  }
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = canvasFont('700', size);
  ctx.lineJoin = 'round';
  ctx.shadowColor = state.template === 'royal' ? 'rgba(170,127,59,.28)' : 'rgba(54,8,46,.72)';
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 3;
  ctx.strokeStyle = state.template === 'royal' ? '#fff5df' : '#651450';
  ctx.lineWidth = state.template === 'royal' ? 6.4 : 5.2;
  ctx.strokeText(text, 600, 970);
  ctx.fillStyle = gold;
  ctx.fillText(text, 600, 970);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = state.template === 'royal' ? 'rgba(204,164,85,.82)' : 'rgba(255,247,188,.7)';
  ctx.lineWidth = 1.2;
  ctx.strokeText(text, 600, 970);
  ctx.restore();
}

function drawBannerSparkle(x, y, size, alpha) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#fff9cf';
  ctx.lineWidth = 1.7;
  ctx.shadowColor = '#ffe17a';
  ctx.shadowBlur = 9;
  ctx.beginPath();
  ctx.moveTo(x - size, y); ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size); ctx.lineTo(x, y + size);
  ctx.moveTo(x - size * .55, y - size * .55); ctx.lineTo(x + size * .55, y + size * .55);
  ctx.moveTo(x + size * .55, y - size * .55); ctx.lineTo(x - size * .55, y + size * .55);
  ctx.stroke();
  ctx.fillStyle = '#fffdf0';
  ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawThaiTitleBanner(theme, time = 0) {
  // Move the complete title assembly as one unit so its frame, text,
  // reflection, sweep light, sparkles and ornaments always stay aligned.
  const titleOffsetY = -18;
  ctx.save();
  ctx.translate(0, titleOffsetY);

  if (titleFrameImage.naturalWidth && state.template !== 'royal') {
    const effect = state.sparkle / 100;
    const pulse = .5 + .5 * Math.sin(time * 2.6);
    ctx.save();

    ctx.save();
    const reflection = ctx.createRadialGradient(600, 1018, 0, 600, 1018, 185);
    reflection.addColorStop(0, `rgba(255,238,158,${(.11 + pulse * .07) * effect})`);
    reflection.addColorStop(.45, `rgba(255,202,102,${.055 * effect})`);
    reflection.addColorStop(1, 'rgba(255,214,135,0)');
    ctx.fillStyle = reflection;
    ctx.fillRect(395, 996, 410, 56);
    ctx.restore();

    ctx.save();
    ctx.shadowColor = 'rgba(96,28,78,.26)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 5;
    ctx.drawImage(titleFrameImage, 25, 185, 2120, 350, 220, 885, 760, 178);
    ctx.restore();

    drawBannerSparkle(246, 970, 7, effect * (.25 + .55 * pulse));
    drawBannerSparkle(954, 970, 7, effect * (.25 + .55 * (1 - pulse)));
    drawBannerSparkle(427, 916, 5, effect * (.18 + .42 * (1 - pulse)));
    drawBannerSparkle(773, 916, 5, effect * (.18 + .42 * pulse));
    drawBannerSparkle(600, 1022, 9, effect * (.22 + .50 * pulse));
    drawThaiTitleText();
    ctx.restore();
    ctx.restore();
    return;
  }

  const path = thaiBannerPath();
  const innerPath = thaiBannerInnerPath();
  const effect = state.sparkle / 100;
  const pulse = .5 + .5 * Math.sin(time * 2.6);
  const fill = ctx.createLinearGradient(235, 0, 965, 0);
  if (state.template === 'royal') {
    fill.addColorStop(0, '#ead8b6');
    fill.addColorStop(.18, '#fff8e9');
    fill.addColorStop(.5, '#ffffff');
    fill.addColorStop(.82, '#fff8e9');
    fill.addColorStop(1, '#ead8b6');
  } else {
    fill.addColorStop(0, '#61005f');
    fill.addColorStop(.18, '#8d087f');
    fill.addColorStop(.5, '#b1129c');
    fill.addColorStop(.82, '#8d087f');
    fill.addColorStop(1, '#61005f');
  }

  ctx.save();
  const reflection = ctx.createRadialGradient(600, 1018, 0, 600, 1018, 185);
  reflection.addColorStop(0, `rgba(255,238,158,${(.12 + pulse * .08) * effect})`);
  reflection.addColorStop(.4, `rgba(255,202,102,${.07 * effect})`);
  reflection.addColorStop(1, 'rgba(255,214,135,0)');
  ctx.fillStyle = reflection;
  ctx.fillRect(395, 995, 410, 58);
  ctx.restore();

  ctx.save();
  ctx.shadowColor = 'rgba(96,28,78,.38)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = fill;
  ctx.fill(path);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#b97809';
  ctx.lineWidth = 13;
  ctx.stroke(path);
  ctx.strokeStyle = '#f4c640';
  ctx.lineWidth = 8;
  ctx.stroke(path);
  ctx.strokeStyle = '#fff0a0';
  ctx.lineWidth = 3.2;
  ctx.stroke(path);

  ctx.save();
  ctx.clip(path);
  const sweepX = 250 + ((time * 105) % 700);
  const sweep = ctx.createLinearGradient(sweepX - 70, 0, sweepX + 70, 0);
  sweep.addColorStop(0, 'rgba(255,255,220,0)');
  sweep.addColorStop(.45, `rgba(255,244,190,${.08 * effect})`);
  sweep.addColorStop(.5, `rgba(255,255,235,${.24 * effect})`);
  sweep.addColorStop(.55, `rgba(255,244,190,${.08 * effect})`);
  sweep.addColorStop(1, 'rgba(255,255,220,0)');
  ctx.fillStyle = sweep;
  ctx.fillRect(sweepX - 70, 915, 140, 112);
  ctx.restore();

  const edgeLight = ctx.createLinearGradient(300, 0, 900, 0);
  edgeLight.addColorStop(0, 'rgba(255,244,180,0)');
  edgeLight.addColorStop(.5, `rgba(255,250,210,${.62 + pulse * .22})`);
  edgeLight.addColorStop(1, 'rgba(255,244,180,0)');
  ctx.strokeStyle = edgeLight;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(334, 924); ctx.quadraticCurveTo(600, 918, 866, 924);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,235,143,.92)';
  ctx.lineWidth = 2.5;
  ctx.stroke(innerPath);
  drawThaiRosette(294, 970, .76);
  drawThaiRosette(906, 970, .76);
  drawBannerSparkle(247, 970, 8, effect * (.35 + .65 * pulse));
  drawBannerSparkle(953, 970, 8, effect * (.35 + .65 * (1 - pulse)));
  drawBannerSparkle(408, 922, 6, effect * (.25 + .55 * (1 - pulse)));
  drawBannerSparkle(792, 922, 6, effect * (.25 + .55 * pulse));
  drawBannerSparkle(600, 1017, 10, effect * (.30 + .60 * pulse));
  ctx.restore();

  drawThaiTitleText();
  ctx.restore();
}

function drawInformation(theme, time = 0) {
  // The signature background already has a carefully painted glow and bottom border.
  // Keep that artwork visible; alternate themes still receive a full color panel.
  if (state.template !== 'classic') {
    const base = ctx.createLinearGradient(0, 920, 0, H);
    if (state.template === 'royal') {
      base.addColorStop(0, '#fffdf9'); base.addColorStop(.56, '#f8f0e7'); base.addColorStop(1, '#fffafd');
    } else {
      base.addColorStop(0, '#fff8ec'); base.addColorStop(1, '#f8e4d4');
    }
    ctx.fillStyle = base; ctx.fillRect(0, 915, W, H - 915);
  }

  drawThaiTitleBanner(theme, time);

  const donorColor = state.template === 'royal' ? '#5b2b57' : theme.ink;
  const donorName = state.donor || 'ชื่อเจ้าภาพ / ผู้ร่วมบุญ';
  centerText(donorName, 600, 1063, 1000, 62, donorColor, '700');

  const secondaryColor = state.template === 'royal' ? '#86653b' : '#875421';
  const amountColor = state.template === 'royal' ? '#6d2e63' : '#7e276f';
  centerText('ร่วมทำบุญกฐิน ณ วิทยาลัยสงฆ์พ่อขุนผาเมือง เพชรบูรณ์', 600, 1128, 1100, 38, state.template === 'royal' ? '#7e3d73' : theme.accent, '700');
  centerText('อ.หล่มสัก จ.เพชรบูรณ์ ในวันที่ ๑๖ พฤศจิกายน ๒๕๖๙', 600, 1173, 1100, 34, secondaryColor, '600');
  centerText(`${thaiNumber(state.amount)} บาท`, 600, 1250, 820, 72, amountColor, '700', state.template === 'royal');

  const divider = ctx.createLinearGradient(215, 0, 985, 0);
  divider.addColorStop(0, 'rgba(218,165,48,0)');
  divider.addColorStop(.18, theme.gold);
  divider.addColorStop(.82, theme.gold);
  divider.addColorStop(1, 'rgba(218,165,48,0)');
  ctx.fillStyle = divider;
  ctx.fillRect(215, 1294, 770, 2);
  ctx.save(); ctx.translate(600, 1295); ctx.rotate(Math.PI / 4); ctx.fillStyle = theme.gold; ctx.fillRect(-6, -6, 12, 12); ctx.restore();

  drawDonationPanel(theme);

  if (state.template !== 'classic') {
    ctx.save();
    const footer = ctx.createLinearGradient(0, 0, W, 0);
    if (state.template === 'royal') {
      footer.addColorStop(0, '#8d5b82'); footer.addColorStop(.16, '#d5b267'); footer.addColorStop(.5, '#fff2c8'); footer.addColorStop(.84, '#d5b267'); footer.addColorStop(1, '#8d5b82');
    } else {
      footer.addColorStop(0, '#7e2877'); footer.addColorStop(.2, theme.gold); footer.addColorStop(.5, '#f6d777'); footer.addColorStop(.8, theme.gold); footer.addColorStop(1, '#7e2877');
    }
    ctx.fillStyle = footer;
    ctx.beginPath(); ctx.moveTo(0, 1474); ctx.bezierCurveTo(180, 1436, 350, 1495, 600, 1471); ctx.bezierCurveTo(830, 1448, 1015, 1494, 1200, 1461); ctx.lineTo(1200, 1500); ctx.lineTo(0, 1500); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

function drawDonationPanel(theme) {
  const isRoyal = state.template === 'royal';
  const x = 120;
  const y = 1310;
  const width = 960;
  const height = 116;

  ctx.save();
  const panel = ctx.createLinearGradient(0, y, 0, y + height);
  if (isRoyal) {
    panel.addColorStop(0, 'rgba(255,255,255,.94)');
    panel.addColorStop(.55, 'rgba(255,250,240,.88)');
    panel.addColorStop(1, 'rgba(246,235,225,.84)');
  } else {
    panel.addColorStop(0, 'rgba(255,253,244,.88)');
    panel.addColorStop(.55, 'rgba(255,246,239,.80)');
    panel.addColorStop(1, 'rgba(251,232,245,.76)');
  }
  ctx.shadowColor = isRoyal ? 'rgba(130,91,46,.18)' : 'rgba(111,48,99,.16)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 4;
  roundedRect(x, y, width, height, 27, panel, isRoyal ? '#d0aa5d' : '#d4a23a', 2.5);
  ctx.shadowColor = 'transparent';
  roundedRect(x + 10, y + 9, width - 20, height - 18, 20, null, isRoyal ? 'rgba(208,170,93,.38)' : 'rgba(211,159,52,.40)', 1.1);

  const ornamentColor = isRoyal ? '#caa45a' : '#c68c24';
  [x + 30, x + width - 30].forEach((ornamentX, index) => {
    ctx.save();
    ctx.translate(ornamentX, y + height / 2);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = ornamentColor;
    ctx.fillRect(-6, -6, 12, 12);
    ctx.strokeStyle = isRoyal ? 'rgba(255,250,232,.95)' : 'rgba(255,249,221,.9)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-3.5, -3.5, 7, 7);
    ctx.restore();
    ctx.strokeStyle = ornamentColor;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    const direction = index === 0 ? 1 : -1;
    ctx.moveTo(ornamentX + direction * 10, y + height / 2);
    ctx.quadraticCurveTo(ornamentX + direction * 22, y + height / 2 - 7, ornamentX + direction * 34, y + height / 2);
    ctx.stroke();
  });
  ctx.restore();

  const headingColor = isRoyal ? '#713568' : '#7b286f';
  const detailColor = isRoyal ? '#655260' : '#62445f';
  const accountColor = isRoyal ? '#5b2854' : '#6f1f68';
  centerText('ร่วมทำบุญออนไลน์ | Online Donation', 600, 1337, 820, 32, headingColor, '700');
  centerText('ธนาคารทหารไทยธนชาต (ttb)  •  ชื่อบัญชี: มจร. วิทยาลัยสงฆ์พ่อขุนผาเมือง เพชรบูรณ์', 600, 1372, 880, 25, detailColor, '600');
  centerText('เลขที่บัญชี / Account No.  356-2-20222-2', 600, 1407, 820, 36, accountColor, '700');
}

function drawGlow() {
  const glow = state.glow / 100;
  if (glow > 0) {
    const halo = ctx.createRadialGradient(600, 560, 20, 600, 560, 540);
    halo.addColorStop(0, `rgba(255,228,131,${.19 * glow})`);
    halo.addColorStop(1, 'rgba(255,228,131,0)');
    ctx.fillStyle = halo; ctx.fillRect(0, 90, W, 970);
  }
}

function drawSparkles(time) {
  const sparkle = state.sparkle / 100;
  if (sparkle <= 0) return;
  ctx.save();
  for (let i = 0; i < 34; i++) {
    const x = 50 + (i * 227) % 1100;
    const y = 160 + (i * 307) % 980;
    const pulse = .28 + .72 * (Math.sin(time * 2 + i * 3.7) * .5 + .5);
    const size = 2 + i % 5;
    ctx.strokeStyle = `rgba(255,237,169,${sparkle * pulse * .8})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x - size * 2, y); ctx.lineTo(x + size * 2, y); ctx.moveTo(x, y - size * 2); ctx.lineTo(x, y + size * 2); ctx.stroke();
    if (i % 4 === 0) { ctx.fillStyle = `rgba(255,255,234,${sparkle * pulse})`; ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();
}

function draw(time = 0) {
  const theme = themes[state.template];
  ctx.clearRect(0, 0, W, H);
  if (state.template === 'classic' && backgroundImage.naturalWidth) drawCover(backgroundImage, 0, 0, W, H);
  else drawCustomBackground(state.template);
  drawHeader(theme);
  // Radiance belongs behind the real portrait and ceremonial objects.
  drawGlow();
  drawPortrait(theme);
  drawOffering();
  drawInformation(theme, time);
  // Fine sparkles remain on top without washing out the lotus colors.
  drawSparkles(time);
}

function animate(time) {
  if (document.visibilityState === 'visible' && state.sparkle > 0 && time - lastFrame > 75) {
    draw(time / 1000);
    lastFrame = time;
  }
  rafId = requestAnimationFrame(animate);
}

async function compressPhoto(file) {
  if (file.size > 10 * 1024 * 1024) throw new Error('รูปภาพมีขนาดเกิน 10 MB');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('รองรับเฉพาะ JPG, PNG และ WEBP');
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('อ่านไฟล์ภาพไม่สำเร็จ'));
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const item = new Image(); item.onload = () => resolve(item); item.onerror = () => reject(new Error('ไฟล์ภาพไม่สมบูรณ์')); item.src = data;
  });
  const maxSide = 1100;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const temp = document.createElement('canvas');
  temp.width = Math.max(1, Math.round(image.naturalWidth * scale));
  temp.height = Math.max(1, Math.round(image.naturalHeight * scale));
  temp.getContext('2d').drawImage(image, 0, 0, temp.width, temp.height);
  return temp.toDataURL('image/jpeg', .8);
}

function slugName() {
  return (state.donor || 'anumodana').replace(/[^\p{L}\p{N}_-]/gu, '_').replace(/_+/g, '_').slice(0, 50);
}

function canvasBlob(type = 'image/png', quality) {
  draw(performance.now() / 1000);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('สร้างรูปไม่สำเร็จ')), type, quality));
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

function getDrafts() {
  const drafts = safeParse(localStorage.getItem(STORAGE_DRAFTS), []);
  return Array.isArray(drafts) ? drafts : [];
}

function smallThumbnail() {
  const thumb = document.createElement('canvas');
  thumb.width = 144; thumb.height = 180;
  thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height);
  return thumb.toDataURL('image/jpeg', .58);
}

function renderDrafts() {
  const list = $('draftList');
  const drafts = getDrafts();
  list.textContent = '';
  if (!drafts.length) {
    const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = 'ยังไม่มีแบบร่างที่บันทึกไว้'; list.append(empty); return;
  }
  drafts.forEach(draft => {
    const card = document.createElement('article'); card.className = 'draft-card';
    const image = document.createElement('img'); image.className = 'draft-thumb'; image.src = draft.thumbnail || ''; image.alt = '';
    const copy = document.createElement('div'); copy.className = 'draft-copy';
    const name = document.createElement('strong'); name.textContent = draft.state?.donor || 'ยังไม่ระบุชื่อ';
    const meta = document.createElement('small'); meta.textContent = `${draft.state?.amount ? Number(draft.state.amount).toLocaleString('th-TH') + ' บาท • ' : ''}${new Date(draft.updatedAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}`;
    copy.append(name, meta);
    const actions = document.createElement('div'); actions.className = 'draft-buttons';
    const open = document.createElement('button'); open.type = 'button'; open.textContent = 'เปิด';
    open.addEventListener('click', async () => {
      state = normalizeState(draft.state); currentDraftId = draft.id; await loadPhoto(state.photoData); syncForm(); draw(0); scheduleAutoSave(); window.scrollTo({ top: 0, behavior: 'smooth' }); toast('เปิดแบบร่างแล้ว');
    });
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'delete'; remove.textContent = 'ลบ';
    remove.addEventListener('click', () => {
      if (!confirm('ลบแบบร่างนี้ออกจากอุปกรณ์?')) return;
      localStorage.setItem(STORAGE_DRAFTS, JSON.stringify(getDrafts().filter(item => item.id !== draft.id)));
      if (currentDraftId === draft.id) currentDraftId = null;
      renderDrafts(); scheduleAutoSave(); toast('ลบแบบร่างแล้ว');
    });
    actions.append(open, remove); card.append(image, copy, actions); list.append(card);
  });
}

function bindInputs() {
  ['donor', 'amount', 'zoom', 'photoY', 'sparkle', 'glow', 'fontFamily', 'fontScale'].forEach(id => {
    $(id).addEventListener('input', event => {
      const numeric = ['zoom', 'photoY', 'sparkle', 'glow'].includes(id);
      state[id] = numeric ? Number(event.target.value) : event.target.value;
      if (id === 'photoY') state.photoY = Number(event.target.value);
      $('zoomValue').value = `${Math.round(state.zoom * 100)}%`;
      $('sparkleValue').value = `${state.sparkle}%`;
      $('glowValue').value = `${state.glow}%`;
      draw(performance.now() / 1000); scheduleAutoSave();
    });
  });
  ['noPhoto', 'thaiDigits'].forEach(id => $(id).addEventListener('change', event => setState({ [id]: event.target.checked }, { form: false })));
  document.querySelectorAll('.template-card').forEach(button => button.addEventListener('click', () => setState({ template: button.dataset.template })));
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * W / rect.width, y: (event.clientY - rect.top) * H / rect.height };
}

function bindPhotoDragging() {
  canvas.addEventListener('pointerdown', event => {
    if (!photoImage || state.noPhoto) return;
    const p = pointerPosition(event);
    if (p.x < 330 || p.x > 870 || p.y < 163 || p.y > 588) return;
    dragging = { p, startX: state.photoX, startY: state.photoY };
    canvas.setPointerCapture(event.pointerId); canvas.classList.add('dragging'); event.preventDefault();
  });
  canvas.addEventListener('pointermove', event => {
    if (!dragging) return;
    const p = pointerPosition(event);
    state.photoX = Math.max(-320, Math.min(320, dragging.startX + p.x - dragging.p.x));
    state.photoY = Math.max(-300, Math.min(300, dragging.startY + p.y - dragging.p.y));
    $('photoY').value = state.photoY;
    draw(performance.now() / 1000); scheduleAutoSave();
  });
  const finish = () => { dragging = null; canvas.classList.remove('dragging'); };
  canvas.addEventListener('pointerup', finish); canvas.addEventListener('pointercancel', finish);
}

async function initialize() {
  await ensureCanvasFonts();
  const stored = safeParse(localStorage.getItem(STORAGE_CURRENT), null);
  if (stored?.state) { state = normalizeState(stored.state); currentDraftId = stored.currentDraftId || null; }
  await loadPhoto(state.photoData);
  syncForm(); bindInputs(); bindPhotoDragging(); renderDrafts();

  $('photo').addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      toast('กำลังเตรียมรูปภาพ…');
      const photoData = await compressPhoto(file); await loadPhoto(photoData);
      setState({ photoData, photoX: 0, photoY: 0, zoom: 1, noPhoto: false });
      toast('เพิ่มรูปภาพแล้ว ลากบนตัวอย่างเพื่อจัดตำแหน่ง');
    } catch (error) { toast(error.message); }
    event.target.value = '';
  });

  $('downloadPNG').addEventListener('click', async () => {
    try { const blob = await canvasBlob(); downloadBlob(blob, `anumodana_${slugName()}.png`); toast('ดาวน์โหลด PNG สำเร็จ'); }
    catch (error) { toast(error.message); }
  });

  $('copyImage').addEventListener('click', async () => {
    try {
      if (!navigator.clipboard || typeof ClipboardItem === 'undefined') throw new Error('เบราว์เซอร์นี้ไม่รองรับการคัดลอกรูป');
      const blob = await canvasBlob(); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); toast('คัดลอกรูปภาพแล้ว');
    } catch (error) { toast(error.message); }
  });

  $('saveDraft').addEventListener('click', () => {
    draw(performance.now() / 1000);
    const drafts = getDrafts();
    const now = new Date().toISOString();
    const id = currentDraftId || (crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`);
    const record = { id, state: { ...state }, thumbnail: smallThumbnail(), updatedAt: now };
    const next = [record, ...drafts.filter(item => item.id !== id)].slice(0, 8);
    try {
      localStorage.setItem(STORAGE_DRAFTS, JSON.stringify(next)); currentDraftId = id; renderDrafts(); scheduleAutoSave(); toast('บันทึกแบบร่างบนอุปกรณ์แล้ว');
    } catch { toast('พื้นที่จัดเก็บของเบราว์เซอร์เต็ม กรุณาลบแบบร่างเก่า'); }
  });

  $('newDraft').addEventListener('click', async () => {
    if ((state.donor || state.photoData) && !confirm('เริ่มภาพใหม่? ข้อมูลที่ยังไม่ได้บันทึกจะถูกแทนที่')) return;
    state = freshState(); currentDraftId = null; photoImage = null; syncForm(); draw(0); scheduleAutoSave(); toast('พร้อมสร้างภาพใหม่');
  });

  $('clearDrafts').addEventListener('click', () => {
    if (!getDrafts().length) return;
    if (!confirm('ลบแบบร่างทั้งหมดออกจากอุปกรณ์นี้?')) return;
    localStorage.removeItem(STORAGE_DRAFTS); currentDraftId = null; renderDrafts(); scheduleAutoSave(); toast('ล้างแบบร่างทั้งหมดแล้ว');
  });

  backgroundImage.addEventListener('load', () => draw(0));
  foregroundImage.addEventListener('load', () => draw(0));
  titleFrameImage.addEventListener('load', () => draw(0));
  portraitFrameImage.addEventListener('load', () => draw(0));
  mcuLogoImage.addEventListener('load', () => draw(0));
  draw(0);
  rafId = requestAnimationFrame(animate);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

initialize().catch(error => toast(`เปิดโปรแกรมไม่สำเร็จ: ${error.message}`));
