/** Test-only stub — see expo-print.ts for why this is aliased in vitest.config.ts. */

let mockFileExists = false;
let mockPickedText: string | null = null;

/** Test hook: controls whether a constructed File reports `.exists`. */
export function __setMockFileExists(value: boolean): void {
  mockFileExists = value;
}

/** Test hook: controls `File.pickFileAsync` — null simulates the user canceling. */
export function __setMockPickedText(text: string | null): void {
  mockPickedText = text;
}

export class Directory {}

export class File {
  uri = 'file://mock';
  exists = mockFileExists;

  create(): void {
    this.exists = true;
  }

  delete(): void {
    this.exists = false;
  }

  write(_content: string): void {
    this.exists = true;
  }

  text(): Promise<string> {
    return Promise.resolve(mockPickedText ?? '');
  }

  static pickFileAsync(): Promise<
    { canceled: true; result: null } | { canceled: false; result: File }
  > {
    if (mockPickedText === null) {
      return Promise.resolve({ canceled: true, result: null });
    }
    return Promise.resolve({ canceled: false, result: new File() });
  }
}

export class Paths {
  static get cache(): Directory {
    return new Directory();
  }

  static get document(): Directory {
    return new Directory();
  }
}
