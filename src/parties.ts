/** A broker firm, authorised by the FSCA as a financial services provider under FAIS. */
export interface Broker {
  id: string;
  name: string;
  fspNumber: string;
}

export interface Client {
  id: string;
  name: string;
}

export interface Underwriter {
  id: string;
  name: string;
  /** Highest referral authority grade this person may clear. */
  authority: number;
}

/** FSP numbers are numeric licence numbers issued by the FSCA. */
export function isValidFspNumber(value: string): boolean {
  return /^\d{1,6}$/.test(value);
}
