// Types mirroring backend NormalizedListing and frontend form state.
// Backend prices are always integer pence — frontend always works in pounds.

export interface NormalizedListing {
  id: string;
  source_id: string;
  listing_url: string;
  address: { raw: string };
  price: {
    guide_price: number | null;   // pence
    reserve_price: number | null; // pence
  };
  property_type: string;
  bedrooms: number | null;
  floor_area_sqft: number | null;
  floor_area_sqm: number | null;
  tenure: string;
  lease: {
    lease_length_years: number | null;
    ground_rent_pa: number | null;    // pence
    service_charge_pa: number | null; // pence
  } | null;
  auction: {
    lot_number: string | null;
    auction_date: string | null;  // ISO datetime string
    auction_house: string | null;
    online_bidding: boolean;
  } | null;
  epc_rating: string | null;
  council_tax_band: string | null;
}

export interface ApiResponse {
  listing: NormalizedListing | null;
  error: string | null;
}

export interface FormState {
  // Property Details
  address: string;
  postcode: string;
  guidePrice: string;           // pounds as string (for controlled input)
  propertyType: string;
  bedrooms: string;
  floorAreaSqft: string;
  floorAreaSqm: string;
  existingGiaSqm: string;
  tenure: string;
  epcRating: string;
  councilTaxBand: string;
  // Auction Details
  lotNumber: string;
  auctionDate: string;          // YYYY-MM-DD
  auctionHouse: string;
  onlineBidding: boolean;
  // Lease Details (visible only when tenure === 'leasehold')
  leaseLength: string;
  groundRent: string;           // pounds as string
  serviceCharge: string;        // pounds as string
  // Financial Inputs (user-entered, no scraped defaults)
  annualRent: string;
  legalFees: string;            // default '1500'
  survey: string;               // default '500'
  resaleValue: string;
  refurbBudget: string;
  additionalProperty: boolean;  // SDLT surcharge toggle
  holdingPeriod: string;            // integer years, default '5'
}

export interface MetricsResult {
  sdlt: number;
  totalAcquisitionCost: number;
  grossRentalYield: number;     // percentage to 1dp
  flipProfit: number;
}

export interface DealReview {
  id: string;
  listing_id: string | null;
  deal_name: string;
  form_snapshot: FormState;
  sdlt: number;                    // pence
  total_acquisition_cost: number;  // pence
  gross_rental_yield: number;      // percentage (e.g. 6.0)
  flip_profit: number;             // pence
  irr: number | null;              // decimal (e.g. 0.085 means 8.5%) — NOT a percentage
  holding_period_years: number;
  created_at: string;              // ISO datetime string
}

export interface RefurbAppraisal {
  id: string;
  name: string;
  inputs_snapshot: Record<string, unknown>;
  net_profit: number | null;    // pence
  margin_pct: number | null;    // percentage (e.g. 15.5)
  irr_equity: number | null;    // percentage (e.g. 18.2)
  created_at: string;           // ISO datetime string
  updated_at: string | null;    // ISO datetime string
}

export interface RefurbProjectSummary {
  irr: number | null;           // percentage (e.g. 18.2)
  equityRequired: number;       // pounds
  projectCost: number;          // pounds
  gdv: number;                  // pounds
  dealScore: number | null;     // 0–10 spider score
  netProfitAmount: number | null; // pounds
  netProfitPercent: number | null; // percentage (e.g. 22.5)
}

export type ScrapeStatus = 'idle' | 'loading' | 'success' | 'error';

export const TENURE_OPTIONS = [
  { value: 'freehold',          label: 'Freehold' },
  { value: 'leasehold',         label: 'Leasehold' },
  { value: 'share_of_freehold', label: 'Share of Freehold' },
  { value: 'commonhold',        label: 'Commonhold' },
  { value: 'unknown',           label: 'Unknown' },
] as const;

export const PROPERTY_TYPE_OPTIONS = [
  { value: 'detached',      label: 'Detached' },
  { value: 'semi_detached', label: 'Semi-Detached' },
  { value: 'terraced',      label: 'Terraced' },
  { value: 'flat',          label: 'Flat' },
  { value: 'maisonette',    label: 'Maisonette' },
  { value: 'bungalow',      label: 'Bungalow' },
  { value: 'land',          label: 'Land' },
  { value: 'commercial',    label: 'Commercial' },
  { value: 'other',         label: 'Other' },
  { value: 'unknown',       label: 'Unknown' },
] as const;

export const EMPTY_FORM: FormState = {
  address: '', postcode: '', guidePrice: '', propertyType: 'unknown', bedrooms: '',
  floorAreaSqft: '', floorAreaSqm: '', existingGiaSqm: '', tenure: 'unknown',
  epcRating: '', councilTaxBand: '',
  lotNumber: '', auctionDate: '', auctionHouse: '', onlineBidding: false,
  leaseLength: '', groundRent: '', serviceCharge: '',
  annualRent: '', legalFees: '1500', survey: '500',
  resaleValue: '', refurbBudget: '',
  additionalProperty: false,
  holdingPeriod: '5',
};
