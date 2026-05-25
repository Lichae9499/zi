import { list, put } from '@vercel/blob';

export const config = {
  runtime: 'edge',
};

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...jsonHeaders, ...(init.headers || {}) },
  });
}

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

async function getEntries() {
  const { blobs } = await list({ prefix: 'entries/', limit: 1000 });
  const entries = await Promise.all(
    blobs
      .filter((blob) => blob.pathname.endsWith('.json'))
      .map(async (blob) => {
        const res = await fetch(blob.url, { cache: 'no-store' });
        if (!res.ok) return null;
        return res.json();
      })
  );

  return json({
    entries: entries
      .filter(Boolean)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
  });
}

async function createEntry(request) {
  const form = await request.formData();
  const dateValue = String(form.get('date') || new Date().toISOString().slice(0, 10));
  const mood = String(form.get('mood') || '新记录').trim() || '新记录';
  const caption = String(form.get('caption') || '新的记忆。').trim() || '新的记忆。';
  const isMasterpiece = String(form.get('isMasterpiece') || '') === 'true';
  const photos = form.getAll('photos').filter((file) => file && file.size > 0);

  if (!photos.length) {
    return json({ error: '请至少上传一张照片。' }, { status: 400 });
  }

  const createdAt = new Date().toISOString();
  const id = `${dateValue}-${Date.now()}`;
  const uploadedPhotos = [];

  for (const [index, file] of photos.entries()) {
    const ext = safeName(file.name).split('.').pop() || 'jpg';
    const pathname = `photos/${id}-${index}.${ext}`;
    const blob = await put(pathname, file, {
      access: 'public',
      contentType: file.type || 'application/octet-stream',
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
    featured: false,
    userAdded: true,
    createdAt,
  };

  await put(`entries/${id}.json`, JSON.stringify(entry), {
    access: 'public',
    contentType: 'application/json; charset=utf-8',
    addRandomSuffix: false,
  });

  return json({ entry }, { status: 201 });
}

export default async function handler(request) {
  try {
    if (request.method === 'GET') return getEntries();
    if (request.method === 'POST') return createEntry(request);
    return json({ error: 'Method not allowed' }, { status: 405 });
  } catch (error) {
    return json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}
