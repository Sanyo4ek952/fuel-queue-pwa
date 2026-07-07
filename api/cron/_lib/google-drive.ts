import { createSign, randomUUID } from 'node:crypto'

import { selectOldQueueBackupFileIds } from './queue-backup.js'

type DriveFile = {
  id: string
  name: string
  createdTime?: string
}

const googleTokenUrl = 'https://oauth2.googleapis.com/token'
const googleDriveUploadUrl = 'https://www.googleapis.com/upload/drive/v3/files'
const googleDriveFilesUrl = 'https://www.googleapis.com/drive/v3/files'
const driveScope = 'https://www.googleapis.com/auth/drive.file'

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

function normalizePrivateKey(privateKey: string) {
  return privateKey.replace(/\\n/g, '\n')
}

function createJwt({
  clientEmail,
  privateKey,
  now,
}: {
  clientEmail: string
  privateKey: string
  now: number
}) {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  }
  const claim = {
    iss: clientEmail,
    scope: driveScope,
    aud: googleTokenUrl,
    exp: now + 3600,
    iat: now,
  }
  const unsignedJwt = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(claim),
  )}`
  const signature = createSign('RSA-SHA256').update(unsignedJwt).sign(normalizePrivateKey(privateKey))

  return `${unsignedJwt}.${base64UrlEncode(signature)}`
}

export async function getGoogleAccessToken({
  clientEmail,
  privateKey,
  fetchImpl = fetch,
  now = Math.floor(Date.now() / 1000),
}: {
  clientEmail: string
  privateKey: string
  fetchImpl?: typeof fetch
  now?: number
}) {
  const assertion = createJwt({ clientEmail, privateKey, now })
  const response = await fetchImpl(googleTokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  const result = (await response.json()) as { access_token?: string; error?: string }

  if (!response.ok || !result.access_token) {
    throw new Error(result.error ?? 'Google access token request failed.')
  }

  return result.access_token
}

export async function getGoogleAccessTokenByRefreshToken({
  clientId,
  clientSecret,
  refreshToken,
  fetchImpl = fetch,
}: {
  clientId: string
  clientSecret: string
  refreshToken: string
  fetchImpl?: typeof fetch
}) {
  const response = await fetchImpl(googleTokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const result = (await response.json()) as {
    access_token?: string
    error?: string
    error_description?: string
  }

  if (!response.ok || !result.access_token) {
    throw new Error(
      result.error_description ?? result.error ?? 'Google refresh token request failed.',
    )
  }

  return result.access_token
}

export async function findDriveFileByName({
  accessToken,
  folderId,
  fileName,
  fetchImpl = fetch,
}: {
  accessToken: string
  folderId: string
  fileName: string
  fetchImpl?: typeof fetch
}) {
  const query = [
    `'${folderId.replaceAll("'", "\\'")}' in parents`,
    `name = '${fileName.replaceAll("'", "\\'")}'`,
    'trashed = false',
  ].join(' and ')
  const url = new URL(googleDriveFilesUrl)
  url.searchParams.set('q', query)
  url.searchParams.set('fields', 'files(id,name,createdTime)')
  url.searchParams.set('pageSize', '1')

  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })
  const result = (await response.json()) as { files?: DriveFile[]; error?: { message?: string } }

  if (!response.ok) {
    throw new Error(result.error?.message ?? 'Google Drive file lookup failed.')
  }

  return result.files?.[0] ?? null
}

export async function uploadQueueBackupToDrive({
  accessToken,
  folderId,
  fileName,
  csv,
  fetchImpl = fetch,
}: {
  accessToken: string
  folderId: string
  fileName: string
  csv: string
  fetchImpl?: typeof fetch
}) {
  const existingFile = await findDriveFileByName({ accessToken, folderId, fileName, fetchImpl })
  const boundary = `queue-backup-${randomUUID()}`
  const metadata = existingFile
    ? { name: fileName, mimeType: 'text/csv' }
    : { name: fileName, mimeType: 'text/csv', parents: [folderId] }
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: text/csv; charset=UTF-8',
    '',
    csv,
    `--${boundary}--`,
    '',
  ].join('\r\n')
  const url = existingFile
    ? `${googleDriveUploadUrl}/${existingFile.id}?uploadType=multipart&fields=id,name`
    : `${googleDriveUploadUrl}?uploadType=multipart&fields=id,name`
  const response = await fetchImpl(url, {
    method: existingFile ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  })
  const result = (await response.json()) as { id?: string; name?: string; error?: { message?: string } }

  if (!response.ok || !result.id) {
    throw new Error(result.error?.message ?? 'Google Drive upload failed.')
  }

  return {
    id: result.id,
    name: result.name ?? fileName,
  }
}

export async function listQueueBackupFiles({
  accessToken,
  folderId,
  fetchImpl = fetch,
}: {
  accessToken: string
  folderId: string
  fetchImpl?: typeof fetch
}) {
  const query = [`'${folderId.replaceAll("'", "\\'")}' in parents`, 'trashed = false'].join(' and ')
  const url = new URL(googleDriveFilesUrl)
  url.searchParams.set('q', query)
  url.searchParams.set('fields', 'files(id,name,createdTime)')
  url.searchParams.set('pageSize', '100')

  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })
  const result = (await response.json()) as { files?: DriveFile[]; error?: { message?: string } }

  if (!response.ok) {
    throw new Error(result.error?.message ?? 'Google Drive file list failed.')
  }

  return result.files ?? []
}

export async function deleteDriveFile({
  accessToken,
  fileId,
  fetchImpl = fetch,
}: {
  accessToken: string
  fileId: string
  fetchImpl?: typeof fetch
}) {
  const response = await fetchImpl(`${googleDriveFilesUrl}/${fileId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error('Google Drive cleanup failed.')
  }
}

export async function cleanupOldQueueBackups({
  accessToken,
  folderId,
  fetchImpl = fetch,
}: {
  accessToken: string
  folderId: string
  fetchImpl?: typeof fetch
}) {
  const files = await listQueueBackupFiles({ accessToken, folderId, fetchImpl })
  const oldFileIds = selectOldQueueBackupFileIds(files)

  await Promise.all(
    oldFileIds.map((fileId: string) => deleteDriveFile({ accessToken, fileId, fetchImpl })),
  )

  return oldFileIds.length
}
