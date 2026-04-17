/**
 * POST /api/secrets
 * Encrypts keystore data with the repo's public key (libsodium sealed_box)
 * and stores it as GitHub Actions repository secrets.
 *
 * Secrets created:
 *   KEYSTORE_FILE   — base64-encoded .jks/.keystore binary
 *   KEYSTORE_ALIAS  — key alias
 *   KEYSTORE_PASS   — keystore password
 *   KEY_PASS        — key password
 *
 * SECURITY: Plaintext is never logged or persisted server-side.
 * The token lives in an httpOnly cookie and is never returned to the client.
 */
import { NextRequest, NextResponse }    from 'next/server';
import { getOctokit }                   from '@/lib/github';
import { encryptSecret, encryptBinarySecret } from '@/lib/secrets';

interface SecretsBody {
  owner:          string;
  repo:           string;
  keystoreBase64: string;   // base64-encoded .jks file
  keystoreAlias:  string;
  keystorePass:   string;
  keyPass:        string;
}

export async function POST(req: NextRequest) {
  const body = await req.json() as SecretsBody;
  const { owner, repo, keystoreBase64, keystoreAlias, keystorePass, keyPass } = body;

  if (!owner || !repo || !keystoreBase64 || !keystoreAlias || !keystorePass) {
    return NextResponse.json({ error: 'All keystore fields are required' }, { status: 400 });
  }

  try {
    const octokit = await getOctokit();

    // 1. Fetch the repo's encryption public key
    const { data: pubKey } = await octokit.actions.getRepoPublicKey({ owner, repo });
    const { key, key_id }  = pubKey;

    // 2. Encrypt each secret with the repo's public key
    const keystoreBuffer = Buffer.from(keystoreBase64, 'base64');

    const [encKeystoreFile, encAlias, encStorePass, encKeyPass] = await Promise.all([
      encryptBinarySecret(keystoreBuffer, key),
      encryptSecret(keystoreAlias, key),
      encryptSecret(keystorePass, key),
      encryptSecret(keyPass || keystorePass, key),
    ]);

    // 3. Upsert each secret into the repo
    const upsert = (secret_name: string, encrypted_value: string) =>
      octokit.actions.createOrUpdateRepoSecret({
        owner, repo, secret_name,
        encrypted_value,
        key_id,
      });

    await Promise.all([
      upsert('KEYSTORE_FILE',  encKeystoreFile),
      upsert('KEYSTORE_ALIAS', encAlias),
      upsert('KEYSTORE_PASS',  encStorePass),
      upsert('KEY_PASS',       encKeyPass),
    ]);

    return NextResponse.json({ ok: true, secretsCreated: ['KEYSTORE_FILE', 'KEYSTORE_ALIAS', 'KEYSTORE_PASS', 'KEY_PASS'] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
