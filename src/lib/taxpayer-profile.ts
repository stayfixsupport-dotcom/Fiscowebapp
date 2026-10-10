export type TaxpayerProfile = {
  displayName: string;
  photo: string | null;
  countryCode: string;
  businessType: string;
  taxResidency: string;
  spokenLanguage: string;
  annualTurnover: string;
  goals: string[];
  documentTypes: string[];
  notes: string;
};

export const EMPTY_TAXPAYER_PROFILE: TaxpayerProfile = {
  displayName: "",
  photo: null,
  countryCode: "",
  businessType: "",
  taxResidency: "",
  spokenLanguage: "",
  annualTurnover: "",
  goals: [],
  documentTypes: [],
  notes: "",
};