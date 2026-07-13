#!/usr/bin/env node
/**
 * One-shot setup for R2 celebration storage:
 * - lists buckets
 * - applies 7-day lifecycle on celebrations/ prefix
 */
import {
  S3Client,
  ListBucketsCommand,
  PutBucketLifecycleConfigurationCommand,
} from '@aws-sdk/client-s3';

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

if (!accountId || !accessKeyId || !secretAccessKey) {
  console.error('Missing R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, or R2_SECRET_ACCESS_KEY');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

const buckets = await s3.send(new ListBucketsCommand({}));
const names = (buckets.Buckets ?? []).map((b) => b.Name).filter(Boolean);
console.log('Buckets:', names.join(', ') || '(none)');

let bucketName = process.env.R2_BUCKET_NAME;
if (!bucketName) {
  bucketName =
    names.find((n) => /fitgen|fit-gen|exercise|media|assets|excers/i.test(n)) ?? names[0];
}
if (!bucketName) {
  console.error('No bucket found. Set R2_BUCKET_NAME.');
  process.exit(1);
}
console.log('Using bucket:', bucketName);

await s3.send(
  new PutBucketLifecycleConfigurationCommand({
    Bucket: bucketName,
    LifecycleConfiguration: {
      Rules: [
        {
          ID: 'delete-celebrations-7d',
          Status: 'Enabled',
          Filter: { Prefix: 'celebrations/' },
          Expiration: { Days: 7 },
        },
      ],
    },
  }),
);

console.log('Lifecycle rule applied via S3 API: celebrations/* deleted after 7 days');
console.log(`R2_BUCKET_NAME=${bucketName}`);
console.log('R2_PUBLIC_URL=https://pub-8d5fa4786e4142aab39adba9d49ee865.r2.dev');
