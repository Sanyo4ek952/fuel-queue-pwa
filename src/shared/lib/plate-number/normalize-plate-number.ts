const cyrillicToLatinMap: Record<string, string> = {
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  У: 'Y',
  Х: 'X',
}

export function normalizePlateNumber(value: string) {
  return value
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[АВЕКМНОРСТУХ]/g, (letter) => cyrillicToLatinMap[letter] ?? letter)
    .replace(/[^0-9A-Z]/g, '')
}
