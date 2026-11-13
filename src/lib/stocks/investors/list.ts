/**
 * Well-known investors whose US holdings are public: each quarter, managers of more than $100 M
 * file a 13F report with the SEC. Identified by their SEC number (CIK). Pure, so the page reads it too.
 */
export interface Investor {
  cik: number;
  /** Who people know. */
  manager: string;
  /** Who files. */
  fund: string;
}

export const INVESTORS: Investor[] = [
  { cik: 1067983, manager: "Warren Buffett", fund: "Berkshire Hathaway" },
  { cik: 1709323, manager: "Li Lu", fund: "Himalaya Capital" },
  { cik: 1336528, manager: "Bill Ackman", fund: "Pershing Square" },
  { cik: 1061768, manager: "Seth Klarman", fund: "Baupost Group" },
  { cik: 1536411, manager: "Stanley Druckenmiller", fund: "Duquesne Family Office" },
  { cik: 1656456, manager: "David Tepper", fund: "Appaloosa" },
  { cik: 1649339, manager: "Michael Burry", fund: "Scion Asset Management" },
  { cik: 1040273, manager: "Dan Loeb", fund: "Third Point" },
  { cik: 1350694, manager: "Ray Dalio", fund: "Bridgewater Associates" },
  { cik: 949509, manager: "Howard Marks", fund: "Oaktree Capital" },
  { cik: 1569205, manager: "Terry Smith", fund: "Fundsmith" },
  { cik: 1112520, manager: "Chuck Akre", fund: "Akre Capital" },
  { cik: 1096343, manager: "Tom Gayner", fund: "Markel Group" },
];
