import { useCallback, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUpload } from '../../hooks/useUpload'
import { useUploadStore } from '../../store'

export default function InvoiceUpload() {
  const { upload, error } = useUpload()
  const { activeUploads } = useUploadStore()
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const file = files[0]
    const invoiceId = await upload(file)
    if (invoiceId) navigate(`/invoices/${invoiceId}`)
  }, [upload, navigate])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const activeList = Object.entries(activeUploads)

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        aria-label="Upload invoice file"
        className={`relative border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
          ${isDragging ? 'border-brand-500 bg-brand-50' : 'border-gray-300 hover:border-brand-400 hover:bg-gray-50'}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.pdf,.tiff"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
          aria-hidden="true"
        />
        <div className="flex flex-col items-center gap-3">
          <div className="w-14 h-14 bg-brand-50 rounded-full flex items-center justify-center">
            <svg className="w-7 h-7 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">Drop invoice here or <span className="text-brand-600">browse</span></p>
            <p className="text-xs text-gray-500 mt-1">PNG, JPG, PDF, TIFF · max 10 MB</p>
          </div>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div role="alert" className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <svg className="w-4 h-4 text-red-500 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Active uploads */}
      {activeList.length > 0 && (
        <ul className="space-y-2" aria-live="polite" aria-label="Upload progress">
          {activeList.map(([id, { filename, progress, status }]) => (
            <li key={id} className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-900 truncate max-w-xs">{filename}</span>
                <span className="text-xs text-gray-500 ml-2 shrink-0">
                  {status === 'uploading' ? `${progress}%` : 'Processing…'}
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                <div
                  className={`h-1.5 rounded-full transition-all duration-300 ${status === 'processing' ? 'bg-yellow-400 animate-pulse' : 'bg-brand-500'}`}
                  style={{ width: status === 'processing' ? '100%' : `${progress}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
