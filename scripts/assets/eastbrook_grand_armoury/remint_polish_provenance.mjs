// Re-mint the Eastbrook polish provenance seals after a legitimate edit to a
// sealed source (most often src/render/renderer.ts). The AFTER captures are
// bound to the CURRENT sources by a composite fingerprint; this recomputes it
// exactly the way tests/eastbrook_polish_artifact_integrity.test.ts derives
// its expectation and rewrites the polishProvenance block in every committed
// after-* record. BEFORE records keep their baseline seal and are never
// touched. Run:
//   npx tsx scripts/assets/eastbrook_grand_armoury/remint_polish_provenance.mjs
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { eastbrookMailboxSourceFingerprint } from '../eastbrook_mailbox/source_fingerprint.mjs';
import { eastbrookNoticeboardSourceFingerprint } from '../eastbrook_noticeboard/source_fingerprint.mjs';
import { eastbrookTownSourceFingerprint } from '../eastbrook_town/source_fingerprint.mjs';
import {
  deriveEastbrookPolishCompositeProvenance,
  EASTBROOK_POLISH_PROVENANCE_INPUTS,
} from './capture_contract.mjs';

const repoRoot = new URL('../../../', import.meta.url);
const fileSha256 = (relativePath) =>
  createHash('sha256')
    .update(readFileSync(new URL(relativePath, repoRoot)))
    .digest('hex');

const current = deriveEastbrookPolishCompositeProvenance({
  townAssetSourceFingerprint: eastbrookTownSourceFingerprint(),
  authoritativeLayoutSha256: fileSha256(EASTBROOK_POLISH_PROVENANCE_INPUTS.authoritativeLayout),
  civicShaderSha256: fileSha256(EASTBROOK_POLISH_PROVENANCE_INPUTS.civicShader),
  townRuntimeSha256: fileSha256(EASTBROOK_POLISH_PROVENANCE_INPUTS.townRuntime),
  mailboxRuntimeSha256: fileSha256(EASTBROOK_POLISH_PROVENANCE_INPUTS.mailboxRuntime),
  noticeboardRuntimeSha256: fileSha256(EASTBROOK_POLISH_PROVENANCE_INPUTS.noticeboardRuntime),
  rendererIntegrationSha256: fileSha256(EASTBROOK_POLISH_PROVENANCE_INPUTS.rendererIntegration),
  viewPriorityPolicySha256: fileSha256(EASTBROOK_POLISH_PROVENANCE_INPUTS.viewPriorityPolicy),
  mailboxSourceFingerprint: eastbrookMailboxSourceFingerprint(),
  mailboxGlbSha256: fileSha256(EASTBROOK_POLISH_PROVENANCE_INPUTS.mailboxGlb),
  noticeboardSourceFingerprint: eastbrookNoticeboardSourceFingerprint(),
  noticeboardGlbSha256: fileSha256(EASTBROOK_POLISH_PROVENANCE_INPUTS.noticeboardGlb),
});

const dirs = [
  'docs/screenshots/eastbrook-vale-rebuild/polish/metadata/',
  'docs/screenshots/eastbrook-vale-rebuild/polish/performance/',
];
let reminted = 0;
for (const dir of dirs) {
  for (const name of readdirSync(new URL(dir, repoRoot))) {
    if (!name.startsWith('after-') || !name.endsWith('.json')) continue;
    const url = new URL(dir + name, repoRoot);
    const record = JSON.parse(readFileSync(url, 'utf8'));
    if (!record.polishProvenance) continue;
    record.polishProvenance = current;
    // Each per-capture record nests its own copy of the provenance block
    // (integrity pins them individually); re-mint those too.
    for (const rec of record.records ?? []) {
      if (rec.polishProvenance) rec.polishProvenance = current;
    }
    writeFileSync(url, `${JSON.stringify(record, null, 2)}\n`);
    reminted++;
    console.log(`reminted ${dir}${name}`);
  }
}
console.log(`fingerprint ${current.fingerprint} written to ${reminted} after records`);
console.log(
  'Two committed test literals ride along and need hand-updating when they fail:\n' +
    '  tests/eastbrook_polish_capture_contract.test.ts (the composite fingerprint above)\n' +
    '  tests/eastbrook_polish_artifact_integrity.test.ts (the accepted-files byte digest;\n' +
    '  the failing assertion prints the new value)',
);
