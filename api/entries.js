import { list, put } from '@vercel/blob';
import busboy from 'busboy';

export const config = {
  api: {
    bodyParser: false,
  },
};

function safeName(name) {
  return String(name || 'photo')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'photo';
}

function formatDate(value) {
  const dt = new Date(`${value}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return { date: value || '', day: '' };
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return {
    date: `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日`,
    day: days[dt.getDay()],
  };
}

function first(value, fallback = '') {
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const photoBuffers = [];

    const bb = busboy({
      headers: req.headers,
      limits: { fileSize: 10 * 1024 * 1024 },
    });

    bb.on('field', (name, value) => {
      if (name in fields) {
        fields[name] = [].concat(fields[name], value);
      } else {
        fields[name] = value;
      }
    });

    const filePromises = [];

    bb.on('file', (name, stream, info) => {
      if (name !== 'photos') { stream.resume(); return; }
      const { filename, mimeType } = info;
      const chunks = [];
      const p = new Promise((res) => {
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => {
          const buffer = Buffer.concat(chunks);
          if (buffer.length > 0) {
            photoBuffers.push({ originalFilename: filename, mimetype: mimeType, buffer });
          }
          res();
        });
      });
      filePromises.push(p);
    });

    bb.on('finish', async () => {
      await Promise.all(filePromises);
      resolve({ fields, photos: photoBuffers });
    });

    bb.on('error', reject);
    req.pipe(bb);
  });
}

async function getEntries(res) {
  const { blobs } = await list({ prefix: 'entries/', limit: 1000 });
  const entries = await Promise.all(
    blobs
      .filter((blob) => blob.pathname.endsWith('.json'))
      .map(async (blob) => {
        const result = await fetch(blob.url, { cache: 'no-store' });
        if (!result.ok) return null;
        return result.json();
      })
  );

  res.status(200).json({
    entries: entries
      .filter(Boolean)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
  });
}

async function createEntry(req, res) {
  const { fields, photos } = await parseForm(req);

  const dateValue = String(first(fields.date, new Date().toISOString().slice(0, 10)));
  const mood = String(first(fields.mood, '新记录')).trim() || '新记录';
  const caption = String(first(fields.caption, '新的记忆。')).trim() || '新的记忆。';
  const isMasterpiece = String(first(fields.isMasterpiece, '')) === 'true';
  const isFeatured = String(first(fields.featured, '')) === 'true';

  if (!photos.length) {
    res.status(400).json({ error: '请至少上传一张照片。' });
    return;
  }

  const createdAt = new Date().toISOString();
  const id = `${dateValue}-${Date.now()}`;
  const uploadedPhotos = [];

  for (const [index, file] of photos.entries()) {
    const ext = safeName(file.originalFilename || 'photo.jpg').split('.').pop() || 'jpg';
    const blob = await put(`photos/${id}-${index}.${ext}`, file.buffer, {
      access: 'public',
      contentType: file.mimetype || 'application/octet-stream',
      addRandomSuffix: false,
    });
    uploadedPhotos.push({ url: blob.url, thumb: blob.url });
  }

  const formatted = formatDate(dateValue);
  const entry = {
    id,
    rawDate: dateValue,
    date: formatted.date,
    day: formatted.day,
    mood,
    caption,
    isMasterpiece,
    photos: uploadedPhotos,
    featured: isFeatured,
    userAdded: true,
    createdAt,
  };

  await put(`entries/${id}.json`, JSON.stringify(entry), {
    access: 'public',
    contentType: 'application/json; charset=utf-8',
    addRandomSuffix: false,
  });

  res.status(201).json({ entry });
}

async function updateEntry(req, res) {
  const { fields } = await parseForm(req);
  const id = String(first(fields.id, '')).trim();
  if (!id) { res.status(400).json({ error: '缺少 id' }); return; }

  const { blobs } = await list({ prefix: `entries/${id}.json`, limit: 1 });
  if (!blobs.length) { res.status(404).json({ error: '未找到该记录' }); return; }

  const result = await fetch(blobs[0].url, { cache: 'no-store' });
  if (!result.ok) { res.status(500).json({ error: '读取记录失败' }); return; }
  const entry = await result.json();

  if (fields.mood !== undefined) entry.mood = String(first(fields.mood, entry.mood)).trim() || entry.mood;
  if (fields.caption !== undefined) entry.caption = String(first(fields.caption, entry.caption)).trim();
  if (fields.isMasterpiece !== undefined) entry.isMasterpiece = String(first(fields.isMasterpiece, '')) === 'true';
  if (fields.featured !== undefined) entry.featured = String(first(fields.featured, '')) === 'true';
  if (fields.date !== undefined) {
    const newDate = String(first(fields.date, entry.rawDate));
    const formatted = formatDate(newDate);
    entry.rawDate = newDate;
    entry.date = formatted.date;
    entry.day = formatted.day;
  }

  await put(`entries/${id}.json`, JSON.stringify(entry), {
    access: 'public',
    contentType: 'application/json; charset=utf-8',
    addRandomSuffix: false,
  });

  res.status(200).json({ entry });
}

export default async function handler(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') { await getEntries(res); return; }
    if (req.method === 'POST') { await createEntry(req, res); return; }
    if (req.method === 'PUT') { await updateEntry(req, res); return; }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('[entries]', error);
    res.status(500).json({ error: error?.message || 'Server error' });
  }
}
