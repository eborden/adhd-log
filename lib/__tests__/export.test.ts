import { beforeEach, describe, expect, it } from 'vitest';
import { __setMockFileExists, __setMockPickedText } from '../__mocks__/expo-file-system';
import { buildBackup } from '../backup';
import { exportJsonBackup, exportPdfReport, importJsonBackup } from '../export';

describe('exportPdfReport', () => {
  it('prints to a file and shares it', async () => {
    await expect(exportPdfReport('<html></html>')).resolves.toBeUndefined();
  });
});

describe('exportJsonBackup', () => {
  it('deletes an existing file before writing, then shares it', async () => {
    __setMockFileExists(true);
    await expect(exportJsonBackup(buildBackup(null, [], {}))).resolves.toBeUndefined();
  });

  it('writes and shares the backup when no file exists yet', async () => {
    __setMockFileExists(false);
    await expect(exportJsonBackup(buildBackup(null, [], {}))).resolves.toBeUndefined();
  });
});

describe('importJsonBackup', () => {
  beforeEach(() => {
    __setMockPickedText(null);
  });

  it('returns ok:false when the user cancels the picker', async () => {
    expect(await importJsonBackup()).toEqual({ ok: false, reason: 'Import canceled' });
  });

  it('returns ok:false when the picked file is not valid JSON', async () => {
    __setMockPickedText('not json');
    const result = await importJsonBackup();
    expect(result.ok).toBe(false);
  });

  it('returns the parsed backup when the picked file is a valid backup', async () => {
    const backup = buildBackup(null, [], {});
    __setMockPickedText(JSON.stringify(backup));
    expect(await importJsonBackup()).toEqual({ ok: true, value: backup });
  });
});
