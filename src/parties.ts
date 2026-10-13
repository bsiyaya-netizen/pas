/** A broker firm, authorised by the FSCA as a financial services provider under FAIS. */
export interface Broker {
  id: string;
  name: string;
  fspNumber: string;
}

export interface Address {
  line1: string;
  line2?: string;
  suburb?: string;
  city: string;
  /** Four-digit South African postal code. */
  postalCode: string;
}

export interface Client {
  id: string;
  name: string;
  /** South African ID number (13 digits). */
  idNumber?: string;
  email?: string;
  phone?: string;
  address?: Address;
}

export interface Underwriter {
  id: string;
  name: string;
  /** The insurer this underwriter works for; they only decide its referrals. */
  insurer: string;
  /** Highest referral authority grade this person may clear. */
  authority: number;
}

/** FSP numbers are numeric licence numbers issued by the FSCA. */
export function isValidFspNumber(value: string): boolean {
  return /^\d{1,6}$/.test(value);
}

/**
 * South African ID numbers: 13 digits, YYMMDD date of birth first, and a Luhn
 * check digit last. Catches most typing mistakes before a document is issued.
 */
export function isValidSaIdNumber(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    let digit = Number(value[12 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}
