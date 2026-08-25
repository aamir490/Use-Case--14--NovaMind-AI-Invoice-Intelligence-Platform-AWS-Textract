import axios from 'axios'
import { requestUploadUrl } from './api'

const ALLOWED_TYPES: Record<string, string> = {
  'image/png':       '.png',
  'image/jpeg':      '.jpg',
  'application/pdf': '.pdf',
  'image/tiff':      '.tiff',
}

export function validateFile(file: File): string | null {
  if (!ALLOWED_TYPES[file.type]) {
    return `Unsupported file type: ${file.type}. Allowed: PNG, JPG, PDF, TIFF`
  }
  if (file.size > 10 * 1024 * 1024) {
    return 'File size must be under 10 MB'
  }
  return null
}

export async function uploadInvoice(
  file: File,
  onProgress: (pct: number) => void,
): Promise<{ invoiceId: string; jobId: string }> {
  // 1. Get pre-signed URL from API
  const { invoice_id, job_id, upload_url } = await requestUploadUrl(file.name, file.type)

  // 2. Upload directly to S3 — no API bandwidth used
  await axios.put(upload_url, file, {
    headers: { 'Content-Type': file.type },
    onUploadProgress: (evt) => {
      const pct = evt.total ? Math.round((evt.loaded / evt.total) * 100) : 0
      onProgress(pct)
    },
  })

  return { invoiceId: invoice_id, jobId: job_id }
}
