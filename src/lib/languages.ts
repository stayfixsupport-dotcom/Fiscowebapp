import ISO6391 from "iso-639-1";

export const LANGUAGES = ISO6391.getAllCodes()
  .map((code) => ({
    code,
    name: ISO6391.getName(code),
    nativeName: ISO6391.getNativeName(code),
  }))
  .sort((first, second) => first.name.localeCompare(second.name));

export function languageName(code: string) {
  return LANGUAGES.find((language) => language.code === code)?.name ?? code;
}