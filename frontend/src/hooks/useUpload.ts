import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { uploadInvoice, validateFile } from '../services/upload'
import { useUploadStore } from '../store'

export function useUpload() {
  const qc = useQueryClient()
  const { addUpload, updateUpload, removeUpload } = useUploadStore()
  const [error, setError] = useState<string | null>(null)

  const upload = useCallback(async (file: File) => {
    setError(null)

    const validationError = validateFile(file)
    if (validationError) {
      setError(validationError)
      return null
    }

    let invoiceId = ''
    try {
      // Placeholder id before we know the real one
      const tempId = `temp_${Date.now()}`
      addUpload(tempId, file.name)

      const { invoiceId: id } = await uploadInvoice(file, (pct) => {
        updateUpload(tempId, pct, 'uploading')
      })

      invoiceId = id
      removeUpload(tempId)
      addUpload(invoiceId, file.name)
      updateUpload(invoiceId, 100, 'processing')

      // Invalidate invoice list so it refreshes with the new pending entry
      qc.invalidateQueries({ queryKey: ['invoices'] })

      return invoiceId
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      setError(msg)
      if (invoiceId) removeUpload(invoiceId)
      return null
    }
  }, [addUpload, updateUpload, removeUpload, qc])

  return { upload, error }
}
