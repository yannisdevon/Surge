export const processLine = (line: string): string | null => {
  if (!line) {
    return null;
  }

  const line_0: string = line[0];

  if (
    line_0 === '#'
    || line_0 === ' '
    || line_0 === '\r'
    || line_0 === '\n'
    || line_0 === '!'
  ) {
    return null;
  }

  const trimmed: string = line.trim();
  if (trimmed === '') {
    return null;
  }

  return trimmed;
};

export const processLineFromReadline = async (rl: AsyncGenerator<string>): Promise<string[]> => {
  const res: string[] = [];
  for await (const line of rl) {
    const l: string | null = processLine(line);
    if (l) {
      res.push(l);
    }
  }
  return res;
};
