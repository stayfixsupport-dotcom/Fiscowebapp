import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { LANGUAGES } from "@/lib/languages";
import { SUPPORTED_INTERFACE_LANGUAGES } from "@/lib/i18n";
import { sfx } from "@/lib/sfx";
import { useT } from "@/lib/ui-prefs";

type LanguagePickerProps = {
  value: string | string[];
  onChange: (value: string | string[]) => void;
  multiple?: boolean;
  interfaceOnly?: boolean;
  placeholder?: string;
  label: string;
};

export function LanguagePicker({
  value,
  onChange,
  multiple = false,
  interfaceOnly = false,
  placeholder = "Choose a language",
  label,
}: LanguagePickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const summary = selected.length > 0 ? selected.join(", ") : t(placeholder);
  const availableLanguages = interfaceOnly
    ? LANGUAGES.filter((language) =>
        SUPPORTED_INTERFACE_LANGUAGES.includes(
          language.code as (typeof SUPPORTED_INTERFACE_LANGUAGES)[number],
        ),
      )
    : LANGUAGES;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          onClick={() => sfx("open")}
          className="press flex min-h-12 w-full items-center gap-3 rounded-2xl border border-border bg-card/80 px-4 text-left transition-colors hover:border-primary/50"
        >
          <span
            className={`min-w-0 flex-1 truncate text-[13px] font-bold ${selected.length ? "text-foreground" : "text-muted-foreground"}`}
          >
            {summary}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="z-[130] overflow-hidden rounded-2xl border-border p-0 shadow-xl"
        style={{
          width: "min(var(--radix-popover-trigger-width, 20rem), calc(100vw - 24px))",
          minWidth: "min(20rem, calc(100vw - 24px))",
          maxWidth: "calc(100vw - 24px)",
          zIndex: 130,
        }}
      >
        <Command>
          <CommandInput placeholder={t("Search languages")} />
          <CommandList className="max-h-72 scroll-py-1">
            <CommandEmpty>{t("No language found.")}</CommandEmpty>
            <CommandGroup>
              {availableLanguages.map((language) => {
                const isSelected = selected.includes(language.name);
                return (
                  <CommandItem
                    key={language.code}
                    value={`${language.name} ${language.nativeName} ${language.code}`}
                    onSelect={() => {
                      sfx("select");
                      if (multiple) {
                        const next = isSelected
                          ? selected.filter((item) => item !== language.name)
                          : [...selected, language.name];
                        onChange(next);
                      } else {
                        onChange(language.name);
                        setOpen(false);
                      }
                    }}
                    className="min-h-11 gap-3 rounded-xl px-3 text-[13px] data-[selected=true]:bg-secondary"
                  >
                    <span className="min-w-0 flex-1 truncate">{language.name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {language.nativeName}
                    </span>
                    {isSelected && <Check className="size-4 shrink-0 text-primary" />}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
