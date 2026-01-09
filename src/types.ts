
export type LinkType = 'accommodation' | 'flight' | 'ferry' | 'activity' | 'transport' | 'restaurant' | 'other';
export type ActivityCategory = 'travel' | 'activity' | 'food' | 'rest';
export type ExpenseCategory = 'lodging' | 'transport' | 'food' | 'activities' | 'other' | 'debt';
export type SplitMethod = 'equal' | 'exact' | 'percent' | 'shares';

export interface Link {
  id: string;
  tripId: string;
  type: LinkType;
  title: string;
  url: string;
  notes?: string;
  tags?: string[];
}

export interface Accommodation {
  id: string;
  tripId: string;
  name: string;
  address?: string;
  checkInDate?: string;
  checkInTime?: string;
  checkOutDate?: string;
  checkOutTime?: string;
  nights?: number;
  guests?: string;
  roomType?: string;
  cost?: number;
  currency?: string;
  bookingUrl?: string;
  contact?: string;
  notes?: string;
  isBooked: boolean;
}

export interface Flight {
  id: string;
  tripId: string;
  travellerId: string;
  airline: string;
  flightNumber: string;
  confirmationCode?: string;
  departureAirport: string;
  departureCity: string;
  departureDate: string;
  departureTime: string;
  arrivalAirport: string;
  arrivalCity: string;
  arrivalDate: string;
  arrivalTime: string;
  seat?: string;
  terminal?: string;
  gate?: string;
  baggage?: string;
  checkInUrl?: string;
  bookingUrl?: string;
  price?: number;
  currency?: string;
  notes?: string;
  status: 'pending' | 'confirmed' | 'checked-in';
}

export interface Transit {
  id: string;
  tripId: string;
  type: 'ferry' | 'train' | 'bus' | 'other';
  operator: string;
  from: string;
  to: string;
  departureDate: string;
  departureTime: string;
  arrivalDate?: string;
  arrivalTime?: string;
  cost?: number;           // ADD THIS
  currency?: string;       // ADD THIS
  confirmationCode?: string;
  url?: string;
  notes?: string;
  isBooked: boolean;
}

export interface Booking {
  id: string;
  tripId: string;
  type: string;
  provider: string;
  confirmationCode?: string;
  startDateTime?: string;
  endDateTime?: string;
  from?: string;
  to?: string;
  cost?: number;
  currency?: string;
  url?: string;
  notes?: string;
  isCompleted: boolean;
}

export interface ItineraryItem {
  id: string;
  tripId: string;
  date: string;
  startTime?: string;
  endTime?: string;
  title: string;
  location?: string;
  category: ActivityCategory;
  status: 'draft' | 'confirmed';
  notes?: string;
  linkUrl?: string;
  isCompleted: boolean;
}

export interface ItineraryDay {
  date: string;
  city: string;
  items: ItineraryItem[];
}

export interface Traveller {
  id: string;
  tripId: string;
  name: string;
  originCity?: string;
  originAirport?: string;
  notes?: string;
}

export interface ExpenseSplit {
  travellerId: string;
  amount?: number;
  percent?: number;
  shares?: number;
}

export interface Expense {
  id: string;
  tripId: string;
  title: string;
  category: ExpenseCategory;
  date: string;
  amount: number;
  currency: string;
  paidByTravellerId: string;
  splitMethod: SplitMethod;
  participantsTravellerIds: string[];
  splits: ExpenseSplit[];
  isPaid: boolean;
  paidAt: string | null;
  notes?: string;
  linkUrl?: string;
  isDebt?: boolean;
}

export interface NetBalance {
  travellerId: string;
  netAmount: number;
}

export interface Balance {
  tripId: string;
  currency: string;
  netByTraveller: NetBalance[];
}

export interface SettlementSuggestion {
  fromTravellerId: string;
  toTravellerId: string;
  amount: number;
  currency: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface Trip {
  id: string;
  name: string;
  destinations: string[];
  startDate: string;
  endDate: string;
  homeBaseTimeZone?: string;
  travellers: Traveller[];
  notes?: string;
  flights: Flight[];
  accommodations: Accommodation[];
  bookings: Booking[];
  transit: Transit[];
  itinerary: ItineraryDay[];
  expenses: Expense[];
  links: Link[];
  balances?: Balance[];
  settlements?: SettlementSuggestion[];
  settledSettlements?: string[]; 
  preferredCurrency?: string;
  lastUpdated: number;
  messages: ChatMessage[];
}

export interface AIStateUpdate {
  formattedSummary: string;
  updatedObjects: {
    trips?: Trip[];
  };
}
