# 云端照片日记部署说明

这个版本支持多人共享和跨设备持久保存：

- 照片保存到 Vercel Blob。
- 日记元数据保存为 Vercel Blob 里的 JSON 文件。
- 前端通过 `/api/entries` 读取和上传。

## 上传到 GitHub

把这些内容上传到仓库根目录：

- `index.html`
- `package.json`
- `api/entries.js`
- `vercel.json`

## Vercel 设置

1. 打开 Vercel 项目。
2. 进入 `Storage`。
3. 创建一个 `Blob` store，并连接到这个项目。
4. Vercel 会自动添加 `BLOB_READ_WRITE_TOKEN` 环境变量。
5. 回到 `Deployments`，点击最新部署的 `Redeploy`。

部署完成后，上传的新照片会保存到云端，换电脑或换浏览器访问同一个 Vercel 地址也能看到。
