/**
 * File Security Middleware
 * 
 * Provides:
 * - Blocked extension list for uploads
 * - File type validation
 * - Security headers for file serving
 * - Secure filename generation with tenant isolation
 */

import { randomUUID } from 'crypto'
import path from 'path'

// Extensions that must NEVER be uploaded/served inline
const BLOCKED_EXTENSIONS = new Set([
  '.html', '.htm', '.xhtml', '.shtml',
  '.svg',  // Can contain embedded JavaScript
  '.js', '.mjs', '.cjs', '.jsx', '.tsx', '.ts',
  '.php', '.asp', '.aspx', '.jsp', '.cgi', '.pl',
  '.exe', '.bat', '.cmd', '.ps1', '.sh', '.bash',
  '.msi', '.dll', '.so', '.dylib',
  '.py', '.rb', '.java', '.class',
  '.swf', '.action',
  '.htaccess', '.htpasswd',
])

// Extensions considered safe for inline display
const INLINE_SAFE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.ico',
  '.mp4', '.webm', '.mov', '.avi',
  '.mp3', '.ogg', '.wav', '.aac', '.m4a', '.opus',
  '.pdf',
  '.txt', '.csv', '.json', '.xml',
])

/**
 * Validates that a filename has an allowed extension.
 * Returns the sanitized name or throws an error.
 */
export function validateAndSanitizeFilename(originalName: string): { safeName: string; extension: string } {
  // Sanitize: remove path traversal, control chars, keep only safe chars
  let safeName = originalName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+/, '_')           // no leading dots
    .replace(/\.{2,}/g, '.')        // no double dots
    .trim()

  if (!safeName || safeName === '_') {
    safeName = 'file'
  }

  const extension = path.extname(safeName).toLowerCase()

  if (BLOCKED_EXTENSIONS.has(extension)) {
    throw new Error(`Tipo de arquivo não permitido: ${extension}`)
  }

  return { safeName, extension }
}

/**
 * Generate a secure stored filename with UUID prefix.
 */
export function generateSecureFilename(originalName: string): string {
  const { safeName } = validateAndSanitizeFilename(originalName)
  return `${randomUUID()}-${safeName}`
}

/**
 * Get security headers for file responses.
 * Forces download for non-safe file types.
 */
export function getFileSecurityHeaders(filename: string): Record<string, string> {
  const ext = path.extname(filename).toLowerCase()
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'Cache-Control': 'private, no-cache',
  }

  // Force download for anything that's not known-safe for inline
  if (!INLINE_SAFE_EXTENSIONS.has(ext)) {
    headers['Content-Disposition'] = `attachment; filename="${path.basename(filename)}"`
    headers['Content-Type'] = 'application/octet-stream'
  }

  return headers
}

/**
 * Validate file size against type-specific limits
 */
export function validateFileSize(size: number, mediaType?: string): void {
  const limits: Record<string, number> = {
    image: 10 * 1024 * 1024,     // 10MB
    audio: 25 * 1024 * 1024,     // 25MB
    video: 50 * 1024 * 1024,     // 50MB
    document: 25 * 1024 * 1024,  // 25MB
    default: 25 * 1024 * 1024,   // 25MB
  }
  const limit = limits[mediaType || 'default'] || limits.default
  if (size > limit) {
    throw new Error(`Arquivo muito grande (${(size / 1024 / 1024).toFixed(1)}MB). Limite: ${(limit / 1024 / 1024).toFixed(0)}MB`)
  }
}
