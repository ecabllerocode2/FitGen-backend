import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const CELEBRATION_TTL_DAYS = 7;

function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) return null;

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export function celebrationExpiresAt(fromDate = new Date()) {
  return new Date(fromDate.getTime() + CELEBRATION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Upload celebration PNG to R2.
 * Bucket lifecycle should delete objects under celebrations/ after 7 days.
 * @returns {Promise<string|null>} public URL or null if R2 is not configured
 */
export async function uploadCelebrationPng(userId, sessionId, buffer) {
  const client = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME;
  const publicBase = process.env.R2_PUBLIC_URL;
  if (!client || !bucket || !publicBase) return null;

  const key = `celebrations/${userId}/${sessionId}.png`;
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: 'image/png',
      CacheControl: 'public, max-age=604800',
    }),
  );

  return `${publicBase.replace(/\/$/, '')}/${key}`;
}

export function isCelebrationStorageConfigured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME &&
      process.env.R2_PUBLIC_URL,
  );
}
