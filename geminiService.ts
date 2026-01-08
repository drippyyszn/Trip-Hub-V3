import { GoogleGenAI, Type } from "@google/genai";
import { Trip, AIStateUpdate, Expense, Flight, Transit, Accommodation, ItineraryItem } from "./types";

const SYSTEM_PROMPT = `Act as TripHub Assistant. Your goal is to update the trip state based on user commands.
Return ONLY a valid JSON object of type AIStateUpdate.

CRITICAL RULES:
1. DELTA UPDATES: Return ONLY the items that are NEW or MODIFIED.
2. TRIP ID: Always use the exact ID provided in context.
3. EXPENSES: When adding expenses, split cost across travellers.
4. MAPPING: 
   - Flights/Stays/Transit -> Respective arrays AND the itinerary days.
   - Visits/Activities -> Itinerary items.
5. FORMATTING: Use YYYY-MM-DD for dates.
6. NO CONVERSATION: Do not include any text outside the JSON.
7. STAY NAMES: Never append your own commentary to the stay name.`;

// Robust Regex Patterns for Local Parser
const PATTERNS = {
  // Matches: activity [at] Time [on] Date
  ACTIVITY: /^(?:add\s+|visit\s+|see\s+|go\s+to\s+)?(.+?)(?:\s+(?:at|@)\s+)?(\d{1,2}(?::\d{2})?(?:\s*[ap]m)?)(?:\s+(?:on|for)?\s*)?(.+)?$/i,
  // Matches: flight [from] X to Y [on] Date. Optional "flight" prefix.
  FLIGHT: /^(?:book\s+|add\s+)?(?:flight|fly)(?:\s+from)?\s+(.+?)\s+(?:to|->|→)\s+(.+?)(?:\s+(?:on|from|starting|leaving)?\s*)?((?:\d{4}-\d{2}-\d{2}|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}).*)?$/i,
  // EXPENSES: Matches payment/expense commands
  EXPENSE: /^(?:add\s+|log\s+)?(?:expense\s+(?:for\s+)?|cost\s+(?:of\s+)?)?(?:lunch|dinner|breakfast|brunch|coffee|tea|snacks|drinks|taxi|uber|lyft|rental|car|groceries|food|restaurant|tickets|museum|entry|admission|souvenirs?|shopping|gas|fuel|parking|toll|tips?|hotel|accommodation|insurance)?\s*(.+?)\s+\$(\d+(?:\.\d{2})?).*$/i, 
  // Matches: train/ferry/bus [from] X to Y [on] Date
  TRANSIT: /^(?:take\s+)?(train|ferry|bus|ferries)\s+(?:from\s+)?(.+?)\s+to\s+(.+?)(?:\s+(?:on\s+|at\s+)?(.+))?$/i,
  // Matches: hotel/stay [in] Location [dates] - Greedy capture for location until month name
  // FIXED STAY PATTERN: Improved to match date ranges (e.g. July 4-10) and optional prepositions more reliably
  STAY: /^(?:book\s+|add\s+)?(?:hotel|stay|room|airbnb|accommodation|hostel)(?:\s+(?:in|at|near))?\s+(.+?)\s+(?:from\s+|starting\s+|on\s+|for\s+)?((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d+(?:(?:-|–|to)\d+)?.*)$/i,
  // TRAVELER: Add traveler to trip
  TRAVELER: /^(?:add|new)\s+(?:travell?er|person|guest|member)\s+(.+)$/i,
  
  // NEW PATTERNS
  SPLIT_SUBSET: /^(.+?)\s+\$(\d+(?:\.\d{2})?)\s+split\s+(?:between|with|among)\s+(.+)$/i,
  QUICK_SPLIT: /^(.+?)\s+\$(\d+(?:\.\d{2})?)\s+split(?:\s+evenly)?$/i,
  SOMEONE_PAID: /^(.+?)\s+(?:paid|covered)\s+\$(\d+(?:\.\d{2})?)(?:\s+for\s+(.+?))?$/i,
  RIDE: /^(?:uber|taxi|lyft|ride)(?:\s+(?:to|from))?\s+(.+?)?\s+\$(\d+(?:\.\d{2})?)$/i,
  MEAL: /^(breakfast|lunch|dinner|brunch)(?:\s+at\s+(.+?))?\s+\$(\d+(?:\.\d{2})?)$/i,
  GENERIC_EXPENSE: /^(.+?)\s*\$(\d+(?:\.\d{2})?)(?:\s+for\s+(.+?))?$/i,
};

const parseDateString = (str: string) => {
  const now = new Date();
  const year = now.getFullYear();

  const months: Record<string, number> = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
  };

  const pad2 = (n: number) => String(n).padStart(2, "0");

  const normalizeTime = (raw?: string) => {
    if (!raw) return "12:00";
    const s = raw.trim().toLowerCase();

    if (/^\d{1,2}:\d{2}$/.test(s)) return s;

    const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]m)$/);
    if (!m) return "12:00";
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2] || "0", 10);
    const ap = m[3];
    if (ap === "pm" && h !== 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return `${pad2(h)}:${pad2(min)}`;
  };

  if (!str || !str.trim()) return { date: now.toISOString().split("T")[0], time: "12:00" };

  const timeMatch =
    str.match(/(\d{1,2}:\d{2}\s*(?:am|pm)?)/i) ||
    str.match(/(\d{1,2}\s*(?:am|pm))/i);

  const time = normalizeTime(timeMatch ? timeMatch[1] : undefined);
  const cleaned = str.replace(timeMatch ? timeMatch[0] : "", " ").replace(/\s+/g, " ").trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return { date: cleaned, time };

  const md = cleaned.toLowerCase().match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?\s+(\d{1,2})(?:\D+(\d{4}))?/
  );
  if (md) {
    const mon = months[md[1].replace(".", "")] || 1;
    const day = parseInt(md[2], 10);
    const y = md[3] ? parseInt(md[3], 10) : year;
    return { date: `${y}-${pad2(mon)}-${pad2(day)}`, time };
  }

  return { date: now.toISOString().split("T")[0], time };
};

const parsePlace = (raw: string) => {
  if (!raw) return { city: '', code: '' };
  
  // Match airport code in parentheses OR as last 3-letter word
  const codeMatch = raw.match(/\(([A-Za-z]{3})\)/) || raw.match(/\b([A-Z]{3})$/);
  const code = codeMatch ? codeMatch[1].toUpperCase() : "";
  
  // Remove airport code from city name
  const city = raw
    .replace(/\s*\([^)]+\)\s*/g, ' ')
    .replace(/\s+[A-Z]{3}$/, '')
    .trim();
  
  return { city: city || raw.trim(), code };
};

export const parseLocalCommand = (input: string, activeTrip: Trip): AIStateUpdate | null => {
  const tripId = activeTrip.id;
  const now = Date.now();

  // --- START NEW PARSERS ---

  // 0. SPLIT_SUBSET (Complex Split)
  const subsetMatch = input.match(PATTERNS.SPLIT_SUBSET);
  if (subsetMatch) {
    const [_, title, amountStr, namesStr] = subsetMatch;
    const amount = parseFloat(amountStr);
    
    // Parse names separated by comma, "and", or "&"
    const targetNames = namesStr.split(/,|&|\s+and\s+/).map(s => s.trim()).filter(Boolean);
    const participants: string[] = [];
    const foundNames: string[] = [];

    targetNames.forEach(name => {
      const t = activeTrip.travellers.find(tr => tr.name.toLowerCase().includes(name.toLowerCase()));
      if (t) {
        participants.push(t.id);
        foundNames.push(t.name);
      }
    });

    if (participants.length === 0) {
       return {
        formattedSummary: `Could not find travellers: "${namesStr}". Check spelling?`,
        updatedObjects: { trips: [] as any }
      };
    }

    // Default payer to first participant found in the group
    const payerId = participants[0];

    const newExpense: Expense = {
      id: `exp-${now}`,
      tripId,
      title: title.trim(),
      amount,
      currency: activeTrip.preferredCurrency || 'CAD',
      date: new Date().toISOString().split('T')[0],
      category: 'other',
      paidByTravellerId: payerId,
      splitMethod: 'equal',
      participantsTravellerIds: participants,
      splits: [],
      isPaid: true,
      paidAt: new Date().toISOString()
    };

    return {
      formattedSummary: `Split ${title.trim()} ($${amount}) between ${foundNames.join(', ')}`,
      updatedObjects: { trips: [{ id: tripId, expenses: [newExpense] } as any] }
    };
  }

  // 1. QUICK_SPLIT
  const quickSplitMatch = input.match(PATTERNS.QUICK_SPLIT);
  if (quickSplitMatch) {
    const [_, title, amountStr] = quickSplitMatch;
    const amount = parseFloat(amountStr);
    const participants = activeTrip.travellers.map(t => t.id);
    const payerId = participants[0] || 'unknown';

    const newExpense: Expense = {
      id: `exp-${now}`,
      tripId,
      title: title.trim(),
      amount,
      currency: activeTrip.preferredCurrency || 'CAD',
      date: new Date().toISOString().split('T')[0],
      category: 'other',
      paidByTravellerId: payerId,
      splitMethod: 'equal',
      participantsTravellerIds: participants,
      splits: [],
      isPaid: true,
      paidAt: new Date().toISOString()
    };

    return {
      formattedSummary: `Split ${title.trim()} ($${amount}) evenly among everyone`,
      updatedObjects: { trips: [{ id: tripId, expenses: [newExpense] } as any] }
    };
  }

  // 2. SOMEONE_PAID
  const someonePaidMatch = input.match(PATTERNS.SOMEONE_PAID);
  if (someonePaidMatch) {
    const [_, personName, amountStr, reason] = someonePaidMatch;
    const amount = parseFloat(amountStr);
    
    const payer = activeTrip.travellers.find(t => 
      t.name.toLowerCase().includes(personName.toLowerCase())
    );
    
    if (!payer) {
      return {
        formattedSummary: `Couldn't find traveller "${personName}". Add them first in the Details tab!`,
        updatedObjects: { trips: [] as any }
      };
    }

    const participants = activeTrip.travellers.map(t => t.id);

    const newExpense: Expense = {
      id: `exp-${now}`,
      tripId,
      title: reason ? reason.trim() : `Paid by ${payer.name}`,
      amount,
      currency: activeTrip.preferredCurrency || 'CAD',
      date: new Date().toISOString().split('T')[0],
      category: 'other',
      paidByTravellerId: payer.id,
      splitMethod: 'equal',
      participantsTravellerIds: participants,
      splits: [],
      isPaid: true,
      paidAt: new Date().toISOString()
    };

    return {
      formattedSummary: `${payer.name} paid $${amount}${reason ? ` for ${reason}` : ''} - split evenly among everyone`,
      updatedObjects: { trips: [{ id: tripId, expenses: [newExpense] } as any] }
    };
  }

  // 3. RIDE
  const rideMatch = input.match(PATTERNS.RIDE);
  if (rideMatch) {
    const [_, loc, amountStr] = rideMatch;
    const amount = parseFloat(amountStr);
    const title = loc ? `Ride to ${loc.trim()}` : "Ride";
    const participants = activeTrip.travellers.map(t => t.id);
    const payerId = participants[0] || 'unknown';

    const newExpense: Expense = {
      id: `exp-${now}`,
      tripId,
      title,
      amount,
      currency: activeTrip.preferredCurrency || 'CAD',
      date: new Date().toISOString().split('T')[0],
      category: 'other',
      paidByTravellerId: payerId,
      splitMethod: 'equal',
      participantsTravellerIds: participants,
      splits: [],
      isPaid: true,
      paidAt: new Date().toISOString()
    };

    return {
      formattedSummary: `Added ${title} ($${amount}) - split evenly`,
      updatedObjects: { trips: [{ id: tripId, expenses: [newExpense] } as any] }
    };
  }

  // 4. MEAL
  const mealMatch = input.match(PATTERNS.MEAL);
  if (mealMatch) {
    const [_, mealType, loc, amountStr] = mealMatch;
    const amount = parseFloat(amountStr);
    const title = loc ? `${mealType} at ${loc.trim()}` : mealType;
    const formattedTitle = title.charAt(0).toUpperCase() + title.slice(1);
    
    const participants = activeTrip.travellers.map(t => t.id);
    const payerId = participants[0] || 'unknown';

    const newExpense: Expense = {
      id: `exp-${now}`,
      tripId,
      title: formattedTitle,
      amount,
      currency: activeTrip.preferredCurrency || 'CAD',
      date: new Date().toISOString().split('T')[0],
      category: 'food',
      paidByTravellerId: payerId,
      splitMethod: 'equal',
      participantsTravellerIds: participants,
      splits: [],
      isPaid: true,
      paidAt: new Date().toISOString()
    };

    return {
      formattedSummary: `Added ${formattedTitle} ($${amount}) - split evenly`,
      updatedObjects: { trips: [{ id: tripId, expenses: [newExpense] } as any] }
    };
  }
// 5. GENERIC_EXPENSE (Catches any "description $amount" not matched above)
console.log('Testing GENERIC_EXPENSE with:', input);
const genericExpenseMatch = input.match(PATTERNS.GENERIC_EXPENSE);
console.log('GENERIC_EXPENSE match result:', genericExpenseMatch);
if (genericExpenseMatch) {
    const [_, description, amountStr, forWhat] = genericExpenseMatch;
    const amount = parseFloat(amountStr);
    const title = forWhat ? `${description.trim()} for ${forWhat.trim()}` : description.trim();
    
    const participants = activeTrip.travellers.map(t => t.id);
    const payerId = participants[0] || 'unknown';

    const newExpense: Expense = {
      id: `exp-${now}`,
      tripId,
      title,
      amount,
      currency: activeTrip.preferredCurrency || 'CAD',
      date: new Date().toISOString().split('T')[0],
      category: 'other',
      paidByTravellerId: payerId,
      splitMethod: 'equal',
      participantsTravellerIds: participants,
      splits: [],
      isPaid: true,
      paidAt: new Date().toISOString()
    };

    return {
      formattedSummary: `Added expense: ${title} ($${amount}) - split evenly`,
      updatedObjects: { trips: [{ id: tripId, expenses: [newExpense] } as any] }
    };
  }

  // --- END NEW PARSERS ---

  // 1. TRANSIT
  const transitMatch = input.match(PATTERNS.TRANSIT);
  if (transitMatch) {
    const [_, type, from, to, dateStr] = transitMatch;
    const { date, time } = parseDateString(dateStr || '');

    const newTransit: Transit = {
      id: `transit-${now}`,
      tripId,
      type: type.toLowerCase() as any,
      operator: type.toUpperCase(),
      from: from.trim(),
      to: to.trim(),
      departureDate: date,
      departureTime: time,
      isBooked: false
    };

    return {
      formattedSummary: `Added ${type}: ${from.trim()} → ${to.trim()}`,
      updatedObjects: { trips: [{ id: tripId, transit: [newTransit] }] as any }
    };
  }

  // 2. EXPENSE (Check before ACTIVITY - must have $ sign)
const expMatch = input.match(PATTERNS.EXPENSE);
if (expMatch) {
  const titleRaw = expMatch[1];
  const amountStr = expMatch[2];
  const amount = parseFloat(amountStr);

  let participants: string[] = [];
  let payerId = '';
  
  // Find payer from "paid by X"
  const payerMatch = input.match(/(?:paid\s+by)\s+([a-z]+)/i);
  if (payerMatch) {
      const pName = payerMatch[1].toLowerCase();
      const pObj = activeTrip.travellers.find(t => t.name.toLowerCase().includes(pName));
      if (pObj) payerId = pObj.id;
  }
  
  // Parse "split with/between X and Y" or "split with X, Y, Z"
  const splitClause = input.match(/(?:split|shared|divided)\s+(?:with|between|among)\s+(.+?)$/i);
  if (splitClause) {
      const namesPart = splitClause[1];
      // Extract all traveler names from the clause
      activeTrip.travellers.forEach(t => {
          if (namesPart.toLowerCase().includes(t.name.toLowerCase())) {
              participants.push(t.id);
          }
      });
      
      // If payer was found and not in participants, add them
      if (payerId && !participants.includes(payerId)) {
          participants.push(payerId);
      }
  }

  // If no split mentioned, include everyone
  if (participants.length === 0) {
      participants = activeTrip.travellers.map(t => t.id);
  }

  // If no payer specified, use first participant or first traveler
  if (!payerId) {
      payerId = participants.length > 0 ? participants[0] : (activeTrip.travellers[0]?.id || 'unknown');
  }

    const newExpense: Expense = {
      id: `exp-${now}`,
      tripId,
      title: titleRaw.trim(),
      amount,
      currency: activeTrip.preferredCurrency || 'CAD',
      date: new Date().toISOString().split('T')[0],
      category: 'other',
      paidByTravellerId: payerId,
      splitMethod: 'equal',
      participantsTravellerIds: participants,
      splits: [],
      isPaid: true,
      paidAt: new Date().toISOString()
    };

    return {
      formattedSummary: `Added expense: ${titleRaw.trim()} ($${amount})`,
      updatedObjects: { trips: [{ id: tripId, expenses: [newExpense] } as any] }
    };
  }

  // 3. FLIGHT
  const flightMatch = input.match(PATTERNS.FLIGHT);
  if (flightMatch) {
    const [_, fromRaw, toRaw, dateStrRaw] = flightMatch;
    
    const fromPlace = parsePlace(fromRaw);
    const toPlace = parsePlace(toRaw);
    
    const dateParts = (dateStrRaw || '').split(/to|-/).map(s => s.trim());
    const { date, time } = parseDateString(dateParts[0] || '');

    const traveller = activeTrip.travellers.find(t => input.toLowerCase().includes(t.name.toLowerCase()));
    const travellerId = traveller ? traveller.id : '';
    
    const flights: Flight[] = [];
    const outbound: Flight = {
      id: `flight-${now}`,
      tripId,
      travellerId,
      airline: 'Flight',
      flightNumber: 'TBD',
      departureAirport: fromPlace.code,
      departureCity: fromPlace.city,
      arrivalAirport: toPlace.code,
      arrivalCity: toPlace.city,
      departureDate: date, 
      departureTime: time,
      arrivalDate: date,
      arrivalTime: '14:00',
      status: 'pending'
    };
    flights.push(outbound);

    if (dateParts.length > 1) {
       let retDateStr = dateParts[1];
       const monthMatch = dateParts[0].match(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/i);
       
       if (/^\d+$/.test(retDateStr) && monthMatch) {
          retDateStr = `${monthMatch[0]} ${retDateStr}`;
       }
       const { date: rDate } = parseDateString(retDateStr);

       flights.push({
         ...outbound,
         id: `flight-${now}-ret`,
         departureAirport: toPlace.code,
         arrivalAirport: fromPlace.code,
         departureCity: toPlace.city,
         arrivalCity: fromPlace.city,
         departureDate: rDate,
         arrivalDate: rDate,
         departureTime: '10:00',
         arrivalTime: '14:00'
       });
    }

    return {
      formattedSummary: `Added ${flights.length} flight(s): ${fromPlace.city} (${fromPlace.code}) <-> ${toPlace.city} (${toPlace.code})`,
      updatedObjects: { trips: [{ id: tripId, flights }] as any }
    };
  }

  // 5. STAY (Moved BEFORE Activity to avoid false positives)
  const stayMatch = input.match(PATTERNS.STAY);
  if (stayMatch) {
    // FIXED STAY PATTERN: Improved parsing for date ranges and string formats
    const [_, loc, dates] = stayMatch;
    const parts = (dates || '').split(/to|-|until|\s+-\s+/); // Handle "to", "-", "until", or " - "
    
    const startStr = parts[0]?.trim() || '';
    let endStr = parts[1]?.trim() || '';

    const { date: startDate } = parseDateString(startStr);
    let endDate = startDate;

    // Handle end date logic
    if (endStr) {
      // If end date is just digits (e.g., "10" from "July 4-10"), prepend month from start date
      if (/^\d+$/.test(endStr)) {
        const startMonth = startStr.match(/^[a-z]+/i)?.[0];
        if (startMonth) {
          endStr = `${startMonth} ${endStr}`;
        }
      }
      const parsedEnd = parseDateString(endStr);
      endDate = parsedEnd.date;
    }

    const newStay: Accommodation = {
      id: `stay-${now}`,
      tripId,
      name: `Stay in ${loc.trim()}`,
      address: loc.trim(),
      checkInDate: startDate,
      checkInTime: '15:00',
      checkOutDate: endDate,
      checkOutTime: '11:00',
      isBooked: false,
      cost: 0,
      currency: activeTrip.preferredCurrency || 'CAD'
    };
    
    return {
      formattedSummary: `Added stay: ${loc.trim()} (${startDate} to ${endDate})`,
      updatedObjects: { trips: [{ id: tripId, accommodations: [newStay] } as any] }
    };
  }

  // 4. ACTIVITY (Last priority - catches anything with time)
const actMatch = input.match(PATTERNS.ACTIVITY);
if (actMatch) {
  const [_, title, timeRaw, dateStr] = actMatch;
  const lowerTitle = title.toLowerCase();
  
  // Exclude if it looks like an expense, transit, or accommodation
  // ADDED: Check if input (not just title) contains $ sign
  const isExcluded = input.includes('$') || lowerTitle.includes('paid') || 
      lowerTitle.includes('cost') || lowerTitle.includes('split') ||
      lowerTitle.includes(' to ') || lowerTitle.includes('->') ||
      lowerTitle.includes('hotel') || lowerTitle.includes('room') ||
      lowerTitle.includes('stay') || lowerTitle.includes('airbnb');
    
    if (!isExcluded) {
        const { date } = parseDateString(dateStr || '');
        const time = timeRaw ? timeRaw.replace(/\s+/g, '').toLowerCase() : '12:00';
        
        const newActivity: ItineraryItem = {
          id: `act-${now}`,
          tripId,
          title: title.trim(),
          date,
          startTime: time,
          category: 'activity',
          status: 'confirmed',
          isCompleted: false
        };
        
        return {
          formattedSummary: `Added activity: ${title.trim()} on ${date} at ${time}`,
          updatedObjects: { trips: [{ id: tripId, itinerary: [{ date, items: [newActivity] }] } as any] }
        };
    }
    // If excluded, fall through to null
  }

  return null;
};

export const processTripInput = async (
  input: string,
  currentTrips: Trip[],
  activeTripId: string | null
): Promise<AIStateUpdate> => {
  const startTime = Date.now();
  const activeTrip = currentTrips.find(t => t.id === activeTripId);
  
  if (!activeTrip) throw new Error("No active trip selected.");

  // 1. Try Local Parse (Speed & Quota Saving)
  try {
    const localResult = parseLocalCommand(input, activeTrip);
    if (localResult) {
      console.log(`[TripHub] Local parse success (${Date.now() - startTime}ms)`);
      return localResult;
    }
  } catch (e) {
    console.warn("[TripHub] Local parse failed, falling back to AI", e);
  }

  // 2. Prepare Payload (Reduced Context)
  const contextPayload = {
    id: activeTrip.id,
    name: activeTrip.name,
    travellers: activeTrip.travellers.map(t => ({ id: t.id, name: t.name })),
    startDate: activeTrip.startDate,
    endDate: activeTrip.endDate,
    recentItemsSummary: [
      ...(activeTrip.expenses || []).slice(-3).map(e => `Expense: ${e.title} $${e.amount}`),
      ...(activeTrip.flights || []).map(f => `Flight: ${f.departureAirport}->${f.arrivalAirport}`),
    ].join("; ")
  };

  // SAFELY ACCESS API KEY
  // In some environments, process might be undefined
  let apiKey = '';
  try {
      if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
          apiKey = process.env.API_KEY;
      }
  } catch (e) {
      console.warn("Could not access API Key from process.env");
  }

  if (!apiKey) {
      throw new Error("API Key is missing or environment is not configured correctly.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = 'gemini-3-flash-preview';

  // 3. AI Request with Timeout & Quota Handling
  // INCREASED TIMEOUT to 30s to avoid premature failures
  const TIMEOUT_MS = 30000;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const responsePromise = ai.models.generateContent({
      model,
      contents: { 
        parts: [
          { text: `ACTIVE_TRIP_CONTEXT: ${JSON.stringify(contextPayload)}` },
          { text: `COMMAND: ${input}` }
        ] 
      },
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        temperature: 0.1,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            formattedSummary: { type: Type.STRING },
            updatedObjects: {
              type: Type.OBJECT,
              properties: {
                trips: {
                  type: Type.ARRAY,
                  items: { 
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      expenses: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: { type: Type.STRING }, title: { type: Type.STRING }, amount: { type: Type.NUMBER }, date: { type: Type.STRING }, category: { type: Type.STRING }, currency: { type: Type.STRING }, paidByTravellerId: { type: Type.STRING }, splitMethod: { type: Type.STRING }, participantsTravellerIds: { type: Type.ARRAY, items: { type: Type.STRING } } } } },
                      flights: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: { type: Type.STRING }, airline: { type: Type.STRING }, flightNumber: { type: Type.STRING }, departureAirport: { type: Type.STRING }, arrivalAirport: { type: Type.STRING }, departureDate: { type: Type.STRING }, arrivalDate: { type: Type.STRING }, departureTime: { type: Type.STRING }, arrivalTime: { type: Type.STRING }, status: { type: Type.STRING } } } },
                      accommodations: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: { type: Type.STRING }, name: { type: Type.STRING }, address: { type: Type.STRING }, checkInDate: { type: Type.STRING }, checkInTime: { type: Type.STRING }, checkOutDate: { type: Type.STRING }, checkOutTime: { type: Type.STRING }, isBooked: { type: Type.BOOLEAN } } } },
                      transit: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: { type: Type.STRING }, type: { type: Type.STRING }, from: { type: Type.STRING }, to: { type: Type.STRING }, departureDate: { type: Type.STRING }, departureTime: { type: Type.STRING } } } },
                      itinerary: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { date: { type: Type.STRING }, items: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: { type: Type.STRING }, title: { type: Type.STRING }, startTime: { type: Type.STRING }, category: { type: Type.STRING } } } } } } }
                    },
                    required: ["id"]
                  }
                }
              },
              required: ["trips"]
            }
          },
          required: ["formattedSummary", "updatedObjects"]
        }
      }
    });

    const response = await Promise.race([
      responsePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Request timed out")), TIMEOUT_MS))
    ]) as any;

    clearTimeout(timeoutId);
    return JSON.parse(response.text.trim()) as AIStateUpdate;

  } catch (error: any) {
    console.error("[TripHub] Process Error:", error);
    
    // Explicit Quota Detection
    // Checks for HTTP 429 status OR "RESOURCE_EXHAUSTED" in message/body
    const errString = JSON.stringify(error);
    const isQuota = 
        error.status === 429 || 
        (error.message && error.message.toLowerCase().includes('quota')) ||
        (error.error && error.error.code === 429) ||
        errString.includes('RESOURCE_EXHAUSTED');

    if (isQuota) {
      throw new Error("QUOTA_EXCEEDED");
    }

    if (error.name === 'AbortError' || error.message.includes('timed out')) {
      throw new Error("Timed out — try again.");
    }
    
    throw new Error("Command failed — check connection.");
  }
};