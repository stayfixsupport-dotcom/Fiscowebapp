import { useMemo, useState } from "react";
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
import { sfx } from "@/lib/sfx";
import { useT, useUIPreferences } from "@/lib/ui-prefs";
import { localeCode } from "@/lib/i18n";

type CurrencyPickerProps = {
  value: string;
  onChange: (currencyCode: string) => void;
  label: string;
  placeholder?: string;
};

type IntlWithCurrencyCatalog = typeof Intl & {
  supportedValuesOf?: (key: "currency") => string[];
};

const CURRENCY_CODES = (Intl as IntlWithCurrencyCatalog).supportedValuesOf?.("currency") ?? [
  "AED",
  "AUD",
  "BRL",
  "CAD",
  "CHF",
  "CNY",
  "DZD",
  "EGP",
  "EUR",
  "GBP",
  "INR",
  "JPY",
  "MAD",
  "PLN",
  "TND",
  "USD",
];

function currencySymbol(code: string, locale: string) {
  try {
    return (
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: code,
        currencyDisplay: "narrowSymbol",
      })
        .formatToParts(0)
        .find((part) => part.type === "currency")?.value ?? code
    );
  } catch {
    return code;
  }
}

export function CurrencyPicker({ value, onChange, label, placeholder }: CurrencyPickerProps) {
  const t = useT();
  const { preferences } = useUIPreferences();
  const locale = localeCode(preferences.language);
  const [open, setOpen] = useState(false);
  const currencies = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: "currency" });
    return CURRENCY_CODES.map((code) => ({
      code,
      name: names.of(code) ?? code,
      symbol: currencySymbol(code, locale),
    })).sort((first, second) => first.name.localeCompare(second.name, locale));
  }, [locale]);
  const selected = currencies.find((currency) => currency.code === value);

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
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold">
            {selected
              ? `${selected.symbol} · ${selected.code} · ${selected.name}`
              : t(placeholder ?? "Choose a currency")}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        data-mobile-keyboard-picker=""
        className="z-[130] overflow-hidden rounded-2xl border-border p-0 shadow-xl"
        style={{ width: "var(--radix-popover-trigger-width)" }}
      >
        <Command>
          <CommandInput placeholder={t("Search currencies")} />
          <CommandList className="max-h-72 scroll-py-1">
            <CommandEmpty>{t("No currency found.")}</CommandEmpty>
            <CommandGroup>
              {currencies.map((currency) => (
                <CommandItem
                  key={currency.code}
                  value={`${currency.name} ${currency.code} ${currency.symbol}`}
                  onSelect={() => {
                    sfx("select");
                    onChange(currency.code);
                    setOpen(false);
                  }}
                  className="min-h-11 gap-3 rounded-xl px-3 text-[13px] data-[selected=true]:bg-secondary"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-secondary/80 font-bold">
                    {currency.symbol}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{currency.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {currency.code}
                  </span>
                  {value === currency.code && <Check className="size-4 shrink-0 text-primary" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
