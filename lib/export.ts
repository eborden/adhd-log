import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';
import { parseBackup, type Backup } from './backup';
import type { Parsed } from './types';

// ---------------------------------------------------------------------------
// Native I/O — PDF print/share and JSON backup export/import.
// ---------------------------------------------------------------------------

export async function exportPdfReport(html: string): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html });
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: 'Share check-in report',
  });
}

export async function exportJsonBackup(backup: Backup): Promise<void> {
  const file = new File(new Directory(Paths.cache), `adhd-log-backup-${backup.exportedAt}.json`);
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(JSON.stringify(backup, null, 2));
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Share backup' });
}

export async function importJsonBackup(): Promise<Parsed<Backup>> {
  const picked = await File.pickFileAsync({ mimeTypes: ['application/json'] });
  if (picked.canceled) {
    return { ok: false, reason: 'Import canceled' };
  }
  const text = await picked.result.text();
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'Selected file is not valid JSON' };
  }
  return parseBackup(parsedJson);
}
