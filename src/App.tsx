import { supabase } from './supabaseClient';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  Trip, ChatMessage, Flight, Accommodation, Traveller, Expense, 
  ItineraryItem, AIStateUpdate, Transit, SplitMethod, ItineraryDay,
  ExpenseSplit, Link
} from './types';
import { processTripInput, parseLocalCommand } from './geminiService';
import { 
  Plane, Hotel, Send, Plus, MapPin, Trash2,
  Loader2, Globe, Clock, X, Check, Search, 
  Compass, Users, Calendar, Navigation, 
  Wallet, PieChart, DollarSign, ArrowRight,
  Map as MapIcon, Ticket, Coffee, Utensils, Camera, Briefcase, 
  AlertCircle, Edit2, Train, Ship, Bus, Link as LinkIcon,
  Luggage, DoorOpen, Hash, UserCircle, Settings, 
  ChevronRight, Moon, Bookmark, BookmarkCheck, LayoutGrid,
  CreditCard, Landmark, Receipt, ExternalLink, Info
} from 'lucide-react';

const STORAGE_VERSION = 'v32';
const LOCAL_STORAGE_KEY = `triphub_data_${STORAGE_VERSION}`;
const ACTIVE_TRIP_KEY = `triphub_active_${STORAGE_VERSION}`;

const CURRENCIES = [
  { code: 'CAD', symbol: '$' },
  { code: 'USD', symbol: '$' }, 
  { code: 'EUR', symbol: '€' },
  { code: 'GBP', symbol: '£' }, 
  { code: 'JPY', symbol: '¥' }, 
  { code: 'AUD', symbol: '$' },
];

// Currency conversion rates (update daily or fetch from API)
const EXCHANGE_RATES: Record<string, Record<string, number>> = {
  CAD: { CAD: 1, USD: 0.73, EUR: 0.68, GBP: 0.58, JPY: 110, AUD: 1.12 },
  USD: { CAD: 1.37, USD: 1, EUR: 0.93, GBP: 0.79, JPY: 150, AUD: 1.53 },
  EUR: { CAD: 1.47, USD: 1.07, EUR: 1, GBP: 0.85, JPY: 161, AUD: 1.64 },
  GBP: { CAD: 1.73, USD: 1.26, EUR: 1.18, GBP: 1, JPY: 189, AUD: 1.93 },
  JPY: { CAD: 0.0091, USD: 0.0067, EUR: 0.0062, GBP: 0.0053, JPY: 1, AUD: 0.010 },
  AUD: { CAD: 0.89, USD: 0.65, EUR: 0.61, GBP: 0.52, JPY: 97, AUD: 1 },
};

const convertCurrency = (amount: number, from: string, to: string): number => {
  if (from === to) return amount;
  return amount * (EXCHANGE_RATES[from]?.[to] || 1);
};

const ADD_TEMPLATES = [
  "flight Montreal (YUL) to Athens (ATH) July 3-18",
  "hotel in Athens July 4-10",
  "taxi $20 split between Panayota and Bianca",
  "add museum visit at 10am on July 5",
  "ferry Athens to Ios on July 4 at 10am"
];

// Basic Airport Data for Offline Calculations
const AIRPORT_OFFSETS: Record<string, number> = {
  YUL: -4, JFK: -4, YYZ: -4, BOS: -4,
  CDG: 2, LHR: 1, AMS: 2, FRA: 2,
  HND: 9, NRT: 9, ATH: 3,
  LAX: -7, SFO: -7, YVR: -7
};

const FLIGHT_ESTIMATES: Record<string, number> = {
  'YUL-CDG': 435, 'CDG-YUL': 450,
  'JFK-LHR': 420, 'LHR-JFK': 445,
  'YUL-LHR': 400, 'LHR-YUL': 420,
  'YUL-AMS': 420, 'AMS-YUL': 435, // Amsterdam
  'YUL-FRA': 445, 'FRA-YUL': 465, // Frankfurt
  'YUL-MUC': 450, 'MUC-YUL': 470, // Munich
  'YUL-ZRH': 435, 'ZRH-YUL': 455, // Zurich
  'YUL-GVA': 435, 'GVA-YUL': 455, // Geneva
  'YUL-BRU': 420, 'BRU-YUL': 440, // Brussels
  'YUL-DUB': 345, 'DUB-YUL': 365, // Dublin
  'YUL-MAD': 435, 'MAD-YUL': 455, // Madrid
  'YUL-BCN': 440, 'BCN-YUL': 460, // Barcelona
  'YUL-LIS': 360, 'LIS-YUL': 385, // Lisbon
  'YUL-FCO': 495, 'FCO-YUL': 525, // Rome (Fiumicino)
  'YUL-MXP': 480, 'MXP-YUL': 510, // Milan (Malpensa)
  'YUL-VCE': 495, 'VCE-YUL': 525, // Venice
  'YUL-ATH': 540, 'ATH-YUL': 610, // Athens
  'YUL-EDI': 360, 'EDI-YUL': 385, // Edinburgh
  'YUL-GLA': 360, 'GLA-YUL': 385, // Glasgow
  'YUL-MAN': 375, 'MAN-YUL': 400, // Manchester
  'YUL-BER': 465, 'BER-YUL': 490, // Berlin
  'YUL-VIE': 495, 'VIE-YUL': 520, // Vienna
};

const formatTime12h = (timeStr?: string) => {
  if (!timeStr || timeStr === 'TBD' || timeStr === '') return '—';
  if (timeStr.toLowerCase().includes('am') || timeStr.toLowerCase().includes('pm')) return timeStr;
  try {
    const [h, m] = timeStr.split(':');
    const hours = parseInt(h, 10);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    return `${hours % 12 || 12}:${(m || '00').padStart(2, '0')} ${ampm}`;
  } catch { return timeStr; }
};

const formatTimestamp = (timestamp: number) => {
  const date = new Date(timestamp);
  
  // Format in EST (America/New_York)
  const timeStr = date.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  
  if (isToday) {
    return timeStr; // Just "2:34 PM"
  } else {
    // Show date too if not today: "Jan 8, 2:34 PM"
    const dateStr = date.toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric'
    });
    return `${dateStr}, ${timeStr}`;
  }
};

const formatDateDisplay = (dateStr?: string) => {
  if (!dateStr || dateStr === 'TBD' || dateStr === '') return '—';
  try {
    const date = new Date(dateStr.split('T')[0] + 'T12:00:00');
    return isNaN(date.getTime()) ? dateStr : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return dateStr; }
};

const computeEstimatedArrival = (flight: Flight) => {
  const from = (flight.departureAirport || '').toUpperCase();
  const to = (flight.arrivalAirport || '').toUpperCase();
  const depTime = flight.departureTime;

  if (!depTime || !depTime.includes(':')) return null;
  if (AIRPORT_OFFSETS[from] === undefined || AIRPORT_OFFSETS[to] === undefined) return null;

  const key = `${from}-${to}`;
  const durationMins = FLIGHT_ESTIMATES[key];
  if (!durationMins || durationMins <= 0) return null;

  const [h, m] = depTime.split(':').map(Number);

  const originOffsetMins = AIRPORT_OFFSETS[from] * 60;
  const utcDepMins = (h * 60 + m) - originOffsetMins;

  const utcArrMins = utcDepMins + durationMins;
  const destOffsetMins = AIRPORT_OFFSETS[to] * 60;

  const localArrMinsTotal = utcArrMins + destOffsetMins;

  let localArrMins = localArrMinsTotal;
  let dayOffset = 0;
  while (localArrMins >= 1440) { localArrMins -= 1440; dayOffset++; }
  while (localArrMins < 0) { localArrMins += 1440; dayOffset--; }

  const arrH = Math.floor(localArrMins / 60);
  const arrM = localArrMins % 60;

  const ampm = arrH >= 12 ? 'PM' : 'AM';
  const h12 = arrH % 12 || 12;

  const arrivalTimeDisplay =
    `${h12}:${arrM.toString().padStart(2, '0')} ${ampm}` +
    (dayOffset !== 0 ? ` (${dayOffset > 0 ? '+' : ''}${dayOffset}d)` : '');

  let arrivalDate: string | undefined = flight.arrivalDate || undefined;
  if (!arrivalDate && flight.departureDate) {
    const d = new Date(flight.departureDate + 'T12:00:00');
    d.setDate(d.getDate() + dayOffset);
    arrivalDate = d.toISOString().split('T')[0];
  }

  return { arrivalTimeDisplay, arrivalDate };
};

const getActivityIcon = (category: string) => {
  switch (category.toLowerCase()) {
    case 'food': return <Utensils className="w-4 h-4" />;
    case 'rest': return <Moon className="w-4 h-4" />;
    case 'travel': return <Plane className="w-4 h-4" />;
    case 'activity': case 'sightseeing': return <Camera className="w-4 h-4" />;
    default: return <MapIcon className="w-4 h-4" />;
  }
};

// Helper for strict timeline sorting by string comparison
const getSortValue = (item: any) => {
  const d = item.date || '9999-99-99';
  let t = item.time || '00:00';
  
  // Normalize time to HH:MM 24h format for consistent string sorting
  let h = 0, m = 0;
  // Try to parse both 24h (14:00) and 12h (2:00 pm) formats
  const match = t.match(/(\d+):(\d+)\s*(am|pm)?/i);
  if (match) {
    h = parseInt(match[1], 10);
    m = parseInt(match[2], 10);
    const ampm = match[3]?.toLowerCase();
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
  }
  
  const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  return `${d}T${timeStr}`;
};

const Modal: React.FC<{
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ title, isOpen, onClose, children }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md animate-in fade-in">
      <div className="bg-white w-full max-w-xl rounded-[3rem] shadow-2xl overflow-hidden animate-in zoom-in-95">
        <div className="px-8 py-6 border-b border-slate-50 flex justify-between items-center bg-slate-50/50">
          <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-xl transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-8 max-h-[85vh] overflow-y-auto custom-scrollbar">
          {children}
        </div>
      </div>
    </div>
  );
};

const FlightCard: React.FC<{
  flight: Flight;
  travellers: Traveller[];
  currencySymbol: string;
  onEdit: (id: string, field: string, value: any) => void;
  onDelete: (id: string) => void;
}> = ({ flight, travellers, currencySymbol, onEdit, onDelete }) => {
  const [isEditing, setIsEditing] = useState(false);
  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') setIsEditing(false); };

  const cycleStatus = () => {
    const statuses: Flight['status'][] = ['pending', 'confirmed', 'checked-in'];
    const currentIdx = statuses.indexOf(flight.status || 'pending');
    onEdit(flight.id, 'status', statuses[(currentIdx + 1) % statuses.length]);
  };

  const getStatusColor = (s: string) => {
    switch(s) {
      case 'confirmed': return 'text-emerald-400 bg-emerald-950/30 border-emerald-900';
      case 'checked-in': return 'text-sky-400 bg-sky-950/30 border-sky-900';
      default: return 'text-amber-400 bg-amber-950/30 border-amber-900';
    }
  };

  const { arrivalTimeDisplay, durationDisplay } = useMemo(() => {
    const from = (flight.departureAirport || '').toUpperCase();
    const to = (flight.arrivalAirport || '').toUpperCase();
    const depTime = flight.departureTime; 
    
    let arrivalTimeDisplay = formatTime12h(flight.arrivalTime);
    let durationDisplay = '—';

    if (depTime && depTime.includes(':') && AIRPORT_OFFSETS[from] !== undefined && AIRPORT_OFFSETS[to] !== undefined) {
      const key = `${from}-${to}`;
      const durationMins = FLIGHT_ESTIMATES[key] || 0;
      
      if (durationMins > 0) {
         const hours = Math.floor(durationMins / 60);
         const mins = durationMins % 60;
         durationDisplay = `~${hours}h ${mins}m`;

         // Only calculate if user hasn't manually set arrival time
         if (!flight.arrivalTime || flight.arrivalTime === '14:00') {
           const [h, m] = depTime.split(':').map(Number);
           const originOffsetMins = AIRPORT_OFFSETS[from] * 60;
           const utcDepMins = (h * 60 + m) - originOffsetMins;
           const utcArrMins = utcDepMins + durationMins;
           const destOffsetMins = AIRPORT_OFFSETS[to] * 60;
           const localArrMinsTotal = utcArrMins + destOffsetMins;
           
           let localArrMins = localArrMinsTotal;
           let dayOffset = 0;
           while (localArrMins >= 1440) { localArrMins -= 1440; dayOffset++; }
           while (localArrMins < 0) { localArrMins += 1440; dayOffset--; }

           const arrH = Math.floor(localArrMins / 60);
           const arrM = localArrMins % 60;
           const ampm = arrH >= 12 ? 'PM' : 'AM';
           const h12 = arrH % 12 || 12;
           arrivalTimeDisplay = `${h12}:${arrM.toString().padStart(2, '0')} ${ampm}${dayOffset > 0 ? ` (+${dayOffset}d)` : ''}`;
         }
      }
    }
    return { arrivalTimeDisplay, durationDisplay };
  }, [flight]);

  const originCity = flight.departureCity || "TBD";
 const originCode = flight.departureAirport || "TBD";
 const destCity = flight.arrivalCity || "TBD";
 const destCode = flight.arrivalAirport || "TBD";

 const origin = `${originCity} (${originCode})`;
 const dest = `${destCity} (${destCode})`;

  return (
    <div className="bg-slate-900 rounded-3xl border border-slate-800 shadow-sm overflow-hidden group hover:shadow-md transition-all">
      <div className="bg-slate-950 text-white px-5 py-3 flex justify-between items-center border-b border-slate-800">
        <div className="flex items-center gap-2 flex-1">
          <Plane className="w-3 h-3 text-sky-400" />
          <span className="font-black uppercase text-[10px] tracking-wider text-slate-200">
  {flight.airline || 'FLIGHT'} | {flight.flightNumber || 'TBD'}
</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={cycleStatus} className={`px-2 py-0.5 rounded-md border text-[8px] font-black uppercase ${getStatusColor(flight.status || 'pending')}`}>
            {flight.status || 'PENDING'}
          </button>
          <div className="flex items-center gap-2">
            <button onClick={() => setIsEditing(!isEditing)} className="p-1 hover:text-sky-300 transition-opacity"><Edit2 className="w-4 h-4 text-slate-400" /></button>
            <button onClick={() => onDelete(flight.id)} className="p-1 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="w-4 h-4 text-slate-400" /></button>
          </div>
        </div>
      </div>
      <div className="p-5">
        {isEditing ? (
          <div className="grid grid-cols-2 gap-3 mb-4 bg-slate-800 p-4 rounded-xl border border-slate-700">
            <div className="col-span-2 space-y-1">
              <label className="text-[8px] font-black uppercase text-slate-400">Airline & Flight #</label>
              <div className="flex gap-2">
                <input className="bg-slate-900 border border-slate-700 text-white p-2 text-[10px] rounded flex-1" value={flight.airline} onChange={e => onEdit(flight.id, 'airline', e.target.value)} onKeyDown={handleKeyDown} />
                <input className="bg-slate-900 border border-slate-700 text-white p-2 text-[10px] rounded w-24" value={flight.flightNumber} onChange={e => onEdit(flight.id, 'flightNumber', e.target.value)} onKeyDown={handleKeyDown} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[8px] font-black uppercase text-slate-400">From</label>
              <input className="w-full bg-slate-900 border border-slate-700 text-white p-2 text-[10px] rounded" value={flight.departureAirport} onChange={e => onEdit(flight.id, 'departureAirport', e.target.value)} onKeyDown={handleKeyDown} />
            </div>
            <div className="space-y-1">
              <label className="text-[8px] font-black uppercase text-slate-400">To</label>
              <input className="w-full bg-slate-900 border border-slate-700 text-white p-2 text-[10px] rounded" value={flight.arrivalAirport} onChange={e => onEdit(flight.id, 'arrivalAirport', e.target.value)} onKeyDown={handleKeyDown} />
            </div>
            <div className="space-y-1">
              <label className="text-[8px] font-black uppercase text-slate-400">Dep Date/Time</label>
              <input type="date" className="w-full bg-slate-900 border border-slate-700 text-white p-2 text-[10px] rounded mb-1" value={flight.departureDate} onChange={e => onEdit(flight.id, 'departureDate', e.target.value)} onKeyDown={handleKeyDown} />
              <input type="time" className="w-full bg-slate-900 border border-slate-700 text-white p-2 text-[10px] rounded" value={flight.departureTime} onChange={e => onEdit(flight.id, 'departureTime', e.target.value)} onKeyDown={handleKeyDown} />
            </div>
            <div className="space-y-1">
              <label className="text-[8px] font-black uppercase text-slate-400">Arr Date/Time</label>
              <input type="date" className="w-full bg-slate-900 border border-slate-700 text-white p-2 text-[10px] rounded mb-1" value={flight.arrivalDate} onChange={e => onEdit(flight.id, 'arrivalDate', e.target.value)} onKeyDown={handleKeyDown} />
              <input type="time" className="w-full bg-slate-900 border border-slate-700 text-white p-2 text-[10px] rounded" value={flight.arrivalTime} onChange={e => onEdit(flight.id, 'arrivalTime', e.target.value)} onKeyDown={handleKeyDown} />
            </div>
            <div className="col-span-2 text-center text-[9px] text-slate-500 italic mt-2">Press Enter to save</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-6">
            <p className="text-2xl font-black text-white uppercase col-span-1 truncate">{origin}</p>
            <p className="text-2xl font-black text-white uppercase col-span-1 text-right truncate">{dest}</p>
            
            <p className="text-[10px] font-bold text-slate-400 col-span-1">{formatDateDisplay(flight.departureDate)}</p>
            <p className="text-[10px] font-bold text-slate-400 col-span-1 text-right">{formatDateDisplay(flight.arrivalDate)}</p>
            
            <p className="text-[10px] font-bold text-sky-400 col-span-1">{formatTime12h(flight.departureTime)}</p>
            <p className="text-[10px] font-bold text-sky-400 col-span-1 text-right">{arrivalTimeDisplay}</p>
            
            {durationDisplay !== '—' && (
              <div className="col-span-2 flex justify-center mt-2">
                 <p className="text-[9px] font-bold text-slate-500 flex items-center gap-1"><Clock className="w-2.5 h-2.5"/> {durationDisplay}</p>
              </div>
            )}
          </div>
        )}
        <div className="flex justify-between items-center text-[9px] font-black uppercase text-slate-500 pt-3 border-t border-slate-800">
          <div className="flex gap-3">
             {/* REMOVED SEAT + UNASSIGNED UI as per request */}
          </div>
          <div className="flex items-center gap-2">
            {flight.bookingUrl && <a href={flight.bookingUrl} target="_blank" rel="noreferrer" className="text-sky-500 hover:underline flex items-center gap-1"><ExternalLink className="w-3 h-3"/></a>}
          </div>
        </div>
      </div>
    </div>
  );
};

const StayCard: React.FC<{
  stay: Accommodation;
  currencySymbol: string;
  onEdit: (id: string, field: string, value: any) => void;
  onDelete: (id: string) => void;
}> = ({ stay, currencySymbol, onEdit, onDelete }) => {
  const [isEditing, setIsEditing] = useState(false);
  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') setIsEditing(false); };

  const nights = useMemo(() => {
    if (!stay.checkInDate || !stay.checkOutDate) return 0;
    const start = new Date(stay.checkInDate);
    const end = new Date(stay.checkOutDate);
    // Use UTC noon to safely calculate difference in days across DST
    const utc1 = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    const utc2 = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
    const diffDays = Math.floor((utc2 - utc1) / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
  }, [stay.checkInDate, stay.checkOutDate]);

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden group hover:shadow-md transition-all">
      <div className="bg-indigo-900 text-white px-5 py-3 flex justify-between items-center">
        <Hotel className="w-3.5 h-3.5 text-indigo-300" />
        <div className="flex items-center gap-2">
          <button onClick={() => setIsEditing(!isEditing)} className="p-1 hover:text-indigo-300 transition-opacity"><Edit2 className="w-4 h-4" /></button>
          <button onClick={() => onDelete(stay.id)} className="p-1 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="p-5">
        {isEditing ? (
          <div className="space-y-3 mb-4">
            <div className="space-y-1">
              <label className="text-[8px] font-black uppercase text-slate-400">Hotel Name</label>
              <input className="w-full border border-slate-300 bg-white p-2 text-[10px] rounded text-slate-900" value={stay.name} onChange={e => onEdit(stay.id, 'name', e.target.value)} onKeyDown={handleKeyDown} />
            </div>
            <div className="space-y-1">
              <label className="text-[8px] font-black uppercase text-slate-400">Address</label>
              <input className="w-full border border-slate-300 bg-white p-2 text-[10px] rounded text-slate-900" value={stay.address || ''} onChange={e => onEdit(stay.id, 'address', e.target.value)} onKeyDown={handleKeyDown} />
            </div>
            <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                    <label className="text-[8px] font-black uppercase text-slate-400">Check-In</label>
                    <input type="date" className="w-full border border-slate-300 bg-white p-2 text-[10px] rounded text-slate-900" value={stay.checkInDate} onChange={e => onEdit(stay.id, 'checkInDate', e.target.value)} />
                    <input type="time" className="w-full border border-slate-300 bg-white p-2 text-[10px] rounded text-slate-900 mt-1" value={stay.checkInTime} onChange={e => onEdit(stay.id, 'checkInTime', e.target.value)} />
                </div>
                <div className="space-y-1">
                    <label className="text-[8px] font-black uppercase text-slate-400">Check-Out</label>
                    <input type="date" className="w-full border border-slate-300 bg-white p-2 text-[10px] rounded text-slate-900" value={stay.checkOutDate} onChange={e => onEdit(stay.id, 'checkOutDate', e.target.value)} />
                    <input type="time" className="w-full border border-slate-300 bg-white p-2 text-[10px] rounded text-slate-900 mt-1" value={stay.checkOutTime} onChange={e => onEdit(stay.id, 'checkOutTime', e.target.value)} />
                </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[8px] font-black uppercase text-slate-400">Price ({currencySymbol})</label>
                <input type="number" className="w-full border border-slate-300 bg-white p-2 text-[10px] rounded text-slate-900" value={stay.cost || 0} onChange={e => onEdit(stay.id, 'cost', parseFloat(e.target.value))} onKeyDown={handleKeyDown} />
              </div>
              <div className="space-y-1">
                <label className="text-[8px] font-black uppercase text-slate-400">Status</label>
                <button type="button" onClick={() => onEdit(stay.id, 'isBooked', !stay.isBooked)} className={`w-full py-2 border rounded text-[10px] font-bold uppercase ${stay.isBooked ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>{stay.isBooked ? 'Booked' : 'Unbooked'}</button>
              </div>
            </div>
            <div className="col-span-2 text-center text-[9px] text-slate-400 italic mt-2">Press Enter to save</div>
          </div>
        ) : (
          <>
            <div className="flex justify-between items-start mb-1">
              <h4 className="text-xl font-black text-slate-900 uppercase truncate">{stay.name || 'Unnamed Stay'}</h4>
              {stay.cost !== undefined && <span className="text-xs font-black text-emerald-600">{currencySymbol}{stay.cost}</span>}
            </div>
            <p className="text-[9px] font-bold text-slate-400 uppercase mb-4 truncate">{stay.address || 'Address pending...'}</p>
          </>
        )}
        <div className="grid grid-cols-2 gap-4 border-t border-slate-50 pt-4 relative">
  {nights > 0 && (
     <div className="absolute top-4 left-1/2 -translate-x-1/2 -translate-y-1/2">
       <div className="bg-slate-50 border border-slate-200 text-slate-400 text-[8px] font-black uppercase px-2 py-0.5 rounded-full shadow-sm">
         {nights} Night{nights !== 1 ? 's' : ''}
       </div>
     </div>
  )}
  <div>
    <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Check-in</p>
    <p className="text-[10px] font-bold text-slate-500">{formatDateDisplay(stay.checkInDate)}</p>
    <p className="text-[10px] font-bold text-slate-900">{formatTime12h(stay.checkInTime)}</p>
  </div>
  <div className="text-right">
    <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Check-out</p>
    <p className="text-[10px] font-bold text-slate-500">{formatDateDisplay(stay.checkOutDate)}</p>
    <p className="text-[10px] font-bold text-slate-900">{formatTime12h(stay.checkOutTime)}</p>
  </div>
</div>
        <div className="mt-3 flex gap-3 text-[9px] font-bold text-slate-400 uppercase items-center">
          <button onClick={() => onEdit(stay.id, 'isBooked', !stay.isBooked)} className={`px-2 py-0.5 rounded border transition-colors ${stay.isBooked ? 'text-emerald-600 border-emerald-200 bg-emerald-50' : 'text-slate-400 border-slate-200'}`}>
             {stay.isBooked ? 'BOOKED' : 'UNBOOKED'}
          </button>
          {stay.guests && <span>{stay.guests} Guests</span>}
          {stay.bookingUrl && <a href={stay.bookingUrl} target="_blank" rel="noreferrer" className="text-sky-600 ml-auto hover:underline"><ExternalLink className="w-3 h-3"/></a>}
        </div>
      </div>
    </div>
  );
};

const TransitCard: React.FC<{
  transit: Transit;
  currencySymbol: string;
  onEdit: (id: string, field: string, value: any) => void;
  onDelete: (id: string) => void;
}> = ({ transit, currencySymbol, onEdit, onDelete }) => {
  const Icon = transit.type === 'ferry' ? Ship : transit.type === 'train' ? Train : Bus;
  const [isEditing, setIsEditing] = useState(false);
  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') setIsEditing(false); };

  // ADD THIS: Calculate duration
  const duration = useMemo(() => {
    if (!transit.departureDate || !transit.departureTime || !transit.arrivalDate || !transit.arrivalTime) {
      return null;
    }
    
    try {
      const depDateTime = new Date(`${transit.departureDate}T${transit.departureTime}`);
      const arrDateTime = new Date(`${transit.arrivalDate}T${transit.arrivalTime}`);
      
      const diffMs = arrDateTime.getTime() - depDateTime.getTime();
      const diffMins = Math.floor(diffMs / (1000 * 60));
      
      if (diffMins <= 0) return null;
      
      const hours = Math.floor(diffMins / 60);
      const mins = diffMins % 60;
      
      return `${hours}h ${mins}m`;
    } catch {
      return null;
    }
  }, [transit.departureDate, transit.departureTime, transit.arrivalDate, transit.arrivalTime]);

  // Fallback rendering
  const fromLoc = transit.from || 'TBD';
  const toLoc = transit.to || 'TBD';

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden group hover:shadow-md transition-all">
      <div className="bg-emerald-900 text-white px-5 py-3 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Icon className="w-3.5 h-3.5 text-emerald-300" />
          <span className="text-[10px] font-black uppercase tracking-widest">{transit.type}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setIsEditing(!isEditing)} className="p-1 hover:text-emerald-300 transition-opacity"><Edit2 className="w-4 h-4" /></button>
          <button onClick={() => onDelete(transit.id)} className="p-1 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="p-5">
        {isEditing ? (
          <div className="space-y-3 mb-4">
            <input className="w-full border border-slate-300 bg-white p-2 text-[10px] rounded text-slate-900" value={transit.operator} onChange={e => onEdit(transit.id, 'operator', e.target.value)} placeholder="Operator" onKeyDown={handleKeyDown} />
            <div className="grid grid-cols-2 gap-2">
              <input className="border border-slate-300 bg-white p-2 text-[10px] rounded text-slate-900" value={transit.from} onChange={e => onEdit(transit.id, 'from', e.target.value)} placeholder="From" onKeyDown={handleKeyDown} />
              <input className="border border-slate-300 bg-white p-2 text-[10px] rounded text-slate-900" value={transit.to} onChange={e => onEdit(transit.id, 'to', e.target.value)} placeholder="To" onKeyDown={handleKeyDown} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                 <label className="text-[8px] font-black uppercase text-slate-400">Departs</label>
                 <input type="date" className="w-full border border-slate-300 bg-white p-2 text-[10px] rounded text-slate-900 mb-1" value={transit.departureDate} onChange={e => onEdit(transit.id, 'departureDate', e.target.value)} onKeyDown={handleKeyDown} />
                 <input type="time" className="w-full border border-slate-300 bg-white p-2 text-[10px] rounded text-slate-900" value={transit.departureTime} onChange={e => onEdit(transit.id, 'departureTime', e.target.value)} onKeyDown={handleKeyDown} />
              </div>
              <div>
                 <label className="text-[8px] font-black uppercase text-slate-400">Arrives</label>
                 <input type="date" className="w-full border border-slate-300 bg-white p-2 text-[10px] rounded text-slate-900 mb-1" value={transit.arrivalDate || ''} onChange={e => onEdit(transit.id, 'arrivalDate', e.target.value)} onKeyDown={handleKeyDown} />
                 <input type="time" className="w-full border border-slate-300 bg-white p-2 text-[10px] rounded text-slate-900" value={transit.arrivalTime || ''} onChange={e => onEdit(transit.id, 'arrivalTime', e.target.value)} onKeyDown={handleKeyDown} />
              </div>
            </div>
            {/* ADD THIS: Price field */}
            <div className="space-y-1">
              <label className="text-[8px] font-black uppercase text-slate-400">Price ({currencySymbol})</label>
              <input 
                type="number" 
                step="0.01" 
                className="w-full border border-slate-300 bg-white p-2 text-[10px] rounded text-slate-900" 
                value={transit.cost || ''} 
                onChange={e => onEdit(transit.id, 'cost', parseFloat(e.target.value) || 0)} 
                onKeyDown={handleKeyDown} 
                placeholder="0.00"
              />
            </div>
            
            <div className="text-center text-[9px] text-slate-400 italic">Press Enter to save</div>
          </div>
        ) : (
          <>
            <div className="flex justify-between items-start mb-1">
              <h4 className="text-xl font-black text-slate-900 uppercase tracking-tighter">{transit.operator || transit.type}</h4>
              {transit.cost !== undefined && transit.cost > 0 && (
                <span className="text-xs font-black text-emerald-600">{currencySymbol}{transit.cost.toFixed(2)}</span>
              )}
            </div>
            <p className="text-[9px] font-bold text-slate-400 uppercase mb-4">{fromLoc} → {toLoc}</p>
          </>
        )}
        <div className="grid grid-cols-2 gap-4 border-t border-slate-50 pt-4">
          <div>
            <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Departure</p>
            <p className="text-[10px] font-bold text-slate-500">{formatDateDisplay(transit.departureDate)}</p>
            <p className="text-[10px] font-bold text-slate-900">{formatTime12h(transit.departureTime)}</p>
          </div>
          <div className="text-right">
             <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Arrival</p>
             <p className="text-[10px] font-bold text-slate-500">{formatDateDisplay(transit.arrivalDate)}</p>
             <p className="text-[10px] font-bold text-slate-900">{formatTime12h(transit.arrivalTime)}</p>
          </div>
        </div>
        {duration && (
          <div className="flex justify-center mt-2">
            <p className="text-[9px] font-bold text-slate-500 flex items-center gap-1">
              <Clock className="w-2.5 h-2.5"/> {duration}
            </p>
          </div>
        )}
        <div className="flex justify-between items-center mt-3 pt-3 border-t border-slate-50">
           <button onClick={() => onEdit(transit.id, 'isBooked', !transit.isBooked)} className={`text-[8px] font-black uppercase px-3 py-1.5 rounded-xl border transition-all ${transit.isBooked ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-slate-50 text-slate-400 border-slate-100'}`}>
             {transit.isBooked ? 'Booked' : 'Unbooked'}
           </button>
           {transit.url && (
            <a href={transit.url} target="_blank" rel="noreferrer" className="text-[9px] font-bold text-sky-600 uppercase hover:underline flex items-center gap-1">Link <ExternalLink className="w-2.5 h-2.5"/></a>
           )}
        </div>
      </div>
    </div>
  );
};

const ExpenseForm: React.FC<{ 
  travellers: Traveller[]; 
  currency: string; 
  existingExpense?: Expense; 
  onSubmit: (data: any) => void; 
}> = ({ travellers, currency, existingExpense, onSubmit }) => {
  const [method, setMethod] = useState<SplitMethod>(existingExpense?.splitMethod || 'equal');
  const [total, setTotal] = useState(existingExpense?.amount || 0);
  const [parts, setParts] = useState<string[]>(existingExpense?.participantsTravellerIds || travellers.map(t => t.id));
  const [values, setValues] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    if (existingExpense?.splits) {
      existingExpense.splits.forEach(s => {
        if (existingExpense.splitMethod === 'exact') initial[s.travellerId] = s.amount || 0;
        else if (existingExpense.splitMethod === 'percent') initial[s.travellerId] = s.percent || 0;
        else if (existingExpense.splitMethod === 'shares') initial[s.travellerId] = s.shares || 1;
      });
    }
    return initial;
  });

  const togglePart = (id: string) => setParts(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);

  const calculateSplits = (): ExpenseSplit[] => {
    return parts.map(pid => {
      let amt = 0;
      if (method === 'equal') amt = total / Math.max(1, parts.length);
      else if (method === 'exact') amt = values[pid] || 0;
      else if (method === 'percent') amt = total * ((values[pid] || 0) / 100);
      else if (method === 'shares') {
        const totalShares = parts.reduce((acc: number, curr) => acc + (values[curr] || 1), 0);
        amt = total * ((values[pid] || 1) / Math.max(1, totalShares));
      }
      return { 
        travellerId: pid, 
        amount: amt, 
        percent: method === 'percent' ? values[pid] : undefined, 
        shares: method === 'shares' ? values[pid] : undefined 
      };
    });
  };

  const calculatedTotal = useMemo(() => {
    if (method === 'equal') return total;
    if (method === 'exact') return Object.values(values).reduce((a: number, b: number) => a + b, 0);
    return total;
  }, [method, total, values]);

  return (
    <form onSubmit={e => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const splits = calculateSplits();
      onSubmit({
        title: fd.get('title'),
        amount: method === 'exact' ? calculatedTotal : total,
        paidByTravellerId: fd.get('payer'),
        splitMethod: method,
        participantsTravellerIds: parts,
        date: existingExpense?.date || new Date().toISOString().split('T')[0],
        currency,
        splits: splits,
        category: fd.get('category') || 'other',
        isPaid: true
      });
    }} className="space-y-6">
      <div className="space-y-2">
        <label className="text-[9px] font-black text-slate-400 uppercase">Title</label>
        <input name="title" defaultValue={existingExpense?.title} className="w-full bg-slate-50 rounded-2xl p-4 text-xs font-bold shadow-inner outline-none text-slate-900 bg-white" required />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-[9px] font-black text-slate-400 uppercase">Amount ({currency})</label>
          <input type="number" step="0.01" value={total} onChange={e => setTotal(parseFloat(e.target.value))} className="w-full bg-slate-50 rounded-2xl p-4 text-xs font-bold shadow-inner outline-none text-slate-900" disabled={method === 'exact'} required />
        </div>
        <div>
          <label className="text-[9px] font-black text-slate-400 uppercase">Paid By</label>
          <select name="payer" defaultValue={existingExpense?.paidByTravellerId} className="w-full bg-slate-50 rounded-2xl p-4 text-[10px] font-bold shadow-inner outline-none text-slate-900">
            {travellers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="text-[9px] font-black text-slate-400 uppercase block mb-3">Split Method</label>
        <div className="grid grid-cols-4 gap-2">
          {(['equal', 'exact', 'percent', 'shares'] as const).map(m => (
            <button key={m} type="button" onClick={() => setMethod(m)} className={`p-3 rounded-xl text-[9px] font-black uppercase border transition-all ${method === m ? 'bg-slate-900 text-white border-slate-900 shadow-md' : 'bg-slate-50 text-slate-400 border-slate-100'}`}>
              {m}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-4 pt-4 border-t border-slate-50 max-h-[250px] overflow-y-auto custom-scrollbar">
        <label className="text-[9px] font-black text-slate-400 uppercase sticky top-0 bg-white z-10 block pb-2">Participants & Values</label>
        {travellers.map(t => (
          <div key={t.id} className="flex items-center gap-4 bg-slate-50 p-3 rounded-2xl border border-transparent hover:border-slate-100 transition-all">
            <input type="checkbox" checked={parts.includes(t.id)} onChange={() => togglePart(t.id)} className="w-4 h-4 rounded text-sky-600 appearance-none border border-slate-300 bg-white checked:bg-sky-600 checked:border-transparent" />
            <span className="text-[10px] font-bold text-slate-700 uppercase flex-1 truncate">{t.name}</span>
            {method !== 'equal' && parts.includes(t.id) && (
              <div className="flex items-center gap-2">
                <input type="number" step="0.01" value={values[t.id] || ''} onChange={e => setValues(prev => ({ ...prev, [t.id]: parseFloat(e.target.value) }))} className="w-20 bg-white border border-slate-200 rounded-lg px-2 py-1 text-[10px] font-black text-right outline-none text-slate-900" placeholder={method === 'shares' ? '1' : '0'} />
                <span className="text-[10px] font-black text-slate-400">{method === 'exact' ? currency : method === 'percent' ? '%' : 'sh'}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-between items-center p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
        <span className="text-[10px] font-black text-emerald-700 uppercase">Running Total</span>
        <span className="text-sm font-black text-emerald-700">{currency} {calculatedTotal.toFixed(2)}</span>
      </div>
      <button type="submit" className="w-full py-5 bg-slate-900 text-white rounded-[2rem] font-black uppercase text-[10px] shadow-xl hover:bg-emerald-600 transition-all">
        {existingExpense ? "Save Changes" : "Log Transaction"}
      </button>
    </form>
  );
};

// Utility to merge arrays by ID (new items added, existing updated)
const mergeBy = (current: any[], incoming: any[]) => {
  if (!incoming) return current;
  const map = new Map(current.map(i => [i.id, i]));
  incoming.forEach(i => map.set(i.id, i));
  return Array.from(map.values());
};

const App: React.FC = () => {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);

  // Minimum swipe distance (in px)
  const minSwipeDistance = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;
    
    if (isLeftSwipe && isChatCollapsed) {
      setIsChatCollapsed(false);
    }
    if (isRightSwipe && !isChatCollapsed) {
      setIsChatCollapsed(true);
    }
  };

  // Load trips from Mock Supabase (LocalStorage) on mount
  useEffect(() => {
    const loadTrips = async () => {
      try {
        const { data, error } = await supabase.from('trips').select('*').order('last_updated', { ascending: false });
        if (error) throw error;
        if (data) {
          setTrips(data.map((row: any) => {
             if (row.data && typeof row.data === 'string') {
                 return JSON.parse(row.data);
             }
             return row;
          }));
        }
      } catch (error) {
        console.error('Error loading trips:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadTrips();
  }, []);

  // Save trips to Mock Supabase whenever they change
  useEffect(() => {
    const saveTrips = async () => {
      try {
        for (const trip of trips) {
          await supabase.from('trips').upsert({
            id: trip.id,
            name: trip.name,
            data: JSON.stringify(trip),
            last_updated: trip.lastUpdated || Date.now()
          });
        }
      } catch (error) {
        console.error('Error saving trips:', error);
      }
    };
    if (trips.length > 0 && !isLoading) saveTrips();
  }, [trips, isLoading]);

  const [activeTripId, setActiveTripId] = useState<string | null>(() => localStorage.getItem(ACTIVE_TRIP_KEY));
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState<'itinerary' | 'bookings' | 'expenses' | 'details'>('itinerary');
  const [activeModal, setActiveModal] = useState<'flight' | 'stay' | 'transit' | 'expense' | 'activity' | 'trip' | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [isAddingTraveller, setIsAddingTraveller] = useState(false);
  const [newTravellerName, setNewTravellerName] = useState('');
  const [transitFilter, setTransitFilter] = useState<'all' | 'ferry' | 'train' | 'bus'>('all');
  const [showExamples, setShowExamples] = useState(false);
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);

  const activeTrip = useMemo(() => trips.find(t => t.id === activeTripId) || null, [trips, activeTripId]);
  const currencySymbol = useMemo(() => CURRENCIES.find(c => c.code === (activeTrip?.preferredCurrency || 'CAD'))?.symbol || '$', [activeTrip]);

  const exampleChips = useMemo(() => {
    return ADD_TEMPLATES;
  }, []);

  useEffect(() => { 
    if (activeTripId) {
      try {
        localStorage.setItem(ACTIVE_TRIP_KEY, activeTripId); 
      } catch (e) {
        console.error("Storage error:", e);
      }
    }
  }, [activeTripId]);

  const handleCreateTrip = (name: string) => {
    const newTrip: Trip = {
      id: `trip-${Date.now()}`,
      name: name || "New Trip",
      destinations: [],
      startDate: "",
      endDate: "",
      travellers: [],
      flights: [],
      accommodations: [],
      bookings: [],
      transit: [],
      itinerary: [],
      expenses: [],
      links: [],
      messages: [],
      preferredCurrency: 'CAD',
      settledSettlements: [],
      lastUpdated: Date.now()
    };
    setTrips(prev => [...prev, newTrip]);
    setActiveTripId(newTrip.id);
    setActiveModal(null);
  };

const handleCopyTrip = async (e: React.MouseEvent, tripId: string) => {
    e.stopPropagation();
    const original = trips.find(t => t.id === tripId);
    if (!original) return;
    
    const newTrip: Trip = {
      ...original,
      id: `trip-${Date.now()}`,
      name: `${original.name} (Copy)`,
      messages: [],
      lastUpdated: Date.now()
    };
    setTrips(prev => [...prev, newTrip]);
    setActiveTripId(newTrip.id);
  };
  
   const handleDeleteTrip = async (e: React.MouseEvent, tripId: string) => {
  e.stopPropagation();

   const trip = trips.find(t => t.id === tripId);
  if (!window.confirm(`Delete "${trip?.name || 'this trip'}" permanently? This cannot be undone.`)) {
    return;
  }

  // 1) Delete from Supabase (real source of truth)
  const { error } = await supabase.from('trips').delete().eq('id', tripId);

  if (error) {
    console.error('Supabase delete failed:', error.message);
    alert("Couldn't delete trip: " + error.message);
    return;
  }

  // 2) Remove from UI
  const newTrips = trips.filter(t => t.id !== tripId);
  setTrips(newTrips);

  // 3) Fix active trip if you deleted it
  if (activeTripId === tripId) {
    setActiveTripId(newTrips.length > 0 ? newTrips[0].id : null);
  }
};

  const handleEditLocal = useCallback((itemId: string, field: string, value: any) => {
    if (!activeTripId) return;
    setTrips(prev => prev.map(trip => {
      if (trip.id !== activeTripId) return trip;
      return {
        ...trip,
        flights: (trip.flights || []).map(f => f.id === itemId ? { ...f, [field]: value } : f),
        accommodations: (trip.accommodations || []).map(a => a.id === itemId ? { ...a, [field]: value } : a),
        transit: (trip.transit || []).map(t => t.id === itemId ? { ...t, [field]: value } : t),
        expenses: (trip.expenses || []).map(e => e.id === itemId ? { ...e, ...(field === '' && typeof value === 'object' ? value : { [field]: value }) } : e),
        itinerary: (trip.itinerary || []).map(day => ({
          ...day,
          items: day.items.map(it => it.id === itemId ? { ...it, [field]: value } : it)
        })),
        [field]: itemId === '' ? value : (trip as any)[field],
        lastUpdated: Date.now()
      };
    }));
  }, [activeTripId]);

  const handleDeleteItem = useCallback((type: string, id: string) => {
    if (!activeTripId) return;
    setTrips(prev => prev.map(t => t.id === activeTripId ? {
      ...t,
      flights: type === 'flight' ? t.flights.filter(f => f.id !== id) : t.flights,
      accommodations: type === 'accommodation' ? t.accommodations.filter(a => a.id !== id) : t.accommodations,
      transit: type === 'transit' ? t.transit.filter(ts => ts.id !== id) : t.transit,
      expenses: type === 'expense' ? t.expenses.filter(e => e.id !== id) : t.expenses,
      travellers: type === 'traveller' ? t.travellers.filter(tr => tr.id !== id) : t.travellers,
      itinerary: t.itinerary.map(day => ({ ...day, items: day.items.filter(it => it.id !== id) })),
      lastUpdated: Date.now()
    } : t));
  }, [activeTripId]);

  const handleManualAdd = (type: string, data: any) => {
    if (!activeTripId) return;
    setTrips(prev => prev.map(t => {
      if (t.id !== activeTripId) return t;
      const id = `${type.substring(0, 2)}-${Date.now()}`;
      if (type === 'activity') {
        const newItinerary = [...(t.itinerary || [])];
        let day = newItinerary.find(d => d.date === data.date);
        if (!day) { day = { date: data.date, city: '', items: [] }; newItinerary.push(day); }
        day.items.push({ ...data, id, status: 'confirmed', isCompleted: false, category: data.category || 'activity' });
        return { ...t, itinerary: newItinerary };
      }
      const field = type === 'accommodation' ? 'accommodations' : type === 'traveller' ? 'travellers' : type === 'transit' ? 'transit' : type + 's';
      return { ...t, [field]: [...((t as any)[field] || []), { ...data, id, tripId: activeTripId }] };
    }));
    setActiveModal(null);
  };

  const getInstantResponse = (input: string): string => {
    const low = input.toLowerCase();
    
    if (low.match(/hotel|stay|room|airbnb|accommodation/)) {
      const locationMatch = input.match(/(?:in|at|near)\s+([a-z\s]+?)(?:\s+(?:from|july|aug|sep|jan|feb|mar|apr|may|jun|oct|nov|dec))/i);
      const location = locationMatch ? locationMatch[1].trim() : "your destination";
      return `✓ Adding accommodation in ${location}. You can edit details in the Bookings tab.`;
    }
    
    if (low.match(/flight|fly/)) {
      const routeMatch = input.match(/(?:from\s+)?([a-z\s()]+?)(?:\s+to|\s+->)\s+([a-z\s()]+)/i);
      if (routeMatch) {
        return `✓ Adding flight from ${routeMatch[1].trim()} to ${routeMatch[2].trim()}. Check Bookings tab to confirm.`;
      }
      return `✓ Adding flight. Check Bookings tab for details.`;
    }
    
    if (low.match(/ferry|train|bus/)) {
      const transitType = low.includes('ferry') ? 'ferry' : low.includes('train') ? 'train' : 'bus';
      return `✓ Adding ${transitType} booking. Details available in Bookings tab.`;
    }
    
    if (low.match(/\$\d+|expense|cost|paid/)) {
      return `✓ Logging expense. View breakdown in Expenses tab.`;
    }
    
    if (low.match(/visit|see|activity|museum|tour/)) {
      return `✓ Added to itinerary. Check Timeline tab to view.`;
    }
    
    return `✓ Processing your request...`;
  };

  const handleClearChat = () => {
  if (!activeTripId) return;
  if (window.confirm('Clear all chat messages? This cannot be undone.')) {
    setTrips(prev => prev.map(t => 
      t.id === activeTripId 
        ? { ...t, messages: [], lastUpdated: Date.now() } 
        : t
    ));
  }
};
  
  const handleSendMessage = async (customInput?: string) => {
  const text = customInput || inputText;
  if (!text.trim() || !activeTrip) return;
  if (!customInput) setInputText('');
  
  // User message
  const newUserMsg: ChatMessage = { id: `m-${Date.now()}`, role: 'user', content: text, timestamp: Date.now() };
  setTrips(prev => prev.map(t => t.id === activeTripId ? { ...t, messages: [...(t.messages || []), newUserMsg] } : t));
  
  try {
    const low = text.toLowerCase().trim();
    
    // Check for help keywords first
    const helpKeywords: Record<string, string> = {
      'flight': '✈️ **To add a flight:**\n\nTry: "flight Montreal (YUL) to Paris (CDG) July 15-30"\n\nOr click the + button in the Bookings tab → Flights section to enter details manually.',
      'hotel': '🏨 **To add accommodation:**\n\nTry: "hotel in Paris July 16-25"\n\nOr click the + button in the Bookings tab → Accommodation section to add manually.',
      'accommodation': '🏨 **To add accommodation:**\n\nTry: "hotel in Paris July 16-25"\n\nOr click the + button in the Bookings tab → Accommodation section to add manually.',
      'stay': '🏨 **To add accommodation:**\n\nTry: "hotel in Paris July 16-25"\n\nOr click the + button in the Bookings tab → Accommodation section to add manually.',
      'ferry': '⛴️ **To add a ferry:**\n\nTry: "ferry Athens to Santorini July 5 at 10am"\n\nOr click the + button in the Bookings tab → Transit section.',
      'train': '🚆 **To add a train:**\n\nTry: "train Paris to Lyon July 20 at 2pm"\n\nOr click the + button in the Bookings tab → Transit section.',
      'bus': '🚌 **To add a bus:**\n\nTry: "bus Barcelona to Madrid July 10 at 9am"\n\nOr click the + button in the Bookings tab → Transit section.',
      'transit': '🚆 **To add transit:**\n\nTry: "train Paris to Lyon July 20 at 2pm"\n\nOr click the + button in the Bookings tab → Transit section.',
      'expense': '💰 **To log an expense:**\n\nTry: "dinner $120 split between Sarah and John"\n\nOr click "Log Transaction" in the Expenses tab to enter manually.',
      'split': '💰 **To split an expense:**\n\nTry: "taxi $45 split equally" or "lunch $80 split between Alice and Bob"\n\nOr click "Log Transaction" in the Expenses tab.',
      'activity': '📍 **To add an activity:**\n\nTry: "visit Louvre Museum July 18 at 10am"\n\nOr click the + button in the Timeline tab to add manually.',
      'visit': '📍 **To add an activity:**\n\nTry: "visit Eiffel Tower July 17 at 3pm"\n\nOr click the + button in the Timeline tab.',
      'help': '💡 **Available Commands:**\n\n• "flight [from] to [destination] [dates]"\n• "hotel in [city] [dates]"\n• "ferry/train/bus [from] to [destination] [date]"\n• "expense $[amount] split [method]"\n• "visit [place] [date] at [time]"\n\nOr use the + buttons in each tab to add items manually!'
    };
    
    // Check if user is asking for help about a specific feature
    for (const [keyword, response] of Object.entries(helpKeywords)) {
      if (low === keyword || low === `${keyword}?` || low === `how to add ${keyword}` || low === `add ${keyword}`) {
        const helpMsg: ChatMessage = { 
          id: `ai-${Date.now()}`, 
          role: 'assistant', 
          content: response, 
          timestamp: Date.now() 
        };
        setTrips(prev => prev.map(t => t.id === activeTripId ? { ...t, messages: [...(t.messages || []), helpMsg] } : t));
        return;
      }
    }
    
    // Use ONLY local parser (no AI/Gemini)
    const localResult = parseLocalCommand(text, activeTrip);
    
    if (localResult && localResult.updatedObjects?.trips) {
      // Apply updates from local parser
      setTrips(prev => prev.map(t => {
        const aiTrip = localResult.updatedObjects.trips!.find(ut => ut.id === t.id);
        if (!aiTrip) return t;

        // Merge Itinerary deeply
        const mergedItinerary = aiTrip.itinerary ? ((currentItin: ItineraryDay[], incomingItin: ItineraryDay[]) => {
            const newItin = [...(currentItin || [])];
            incomingItin.forEach(incDay => {
                const idx = newItin.findIndex(d => d.date === incDay.date);
                if (idx >= 0) {
                    newItin[idx] = { ...newItin[idx], ...incDay, items: mergeBy(newItin[idx].items, incDay.items) };
                } else {
                    newItin.push(incDay);
                }
            });
            return newItin;
        })(t.itinerary, aiTrip.itinerary) : t.itinerary;

        return {
           ...t,
           ...aiTrip,
           flights: aiTrip.flights ? mergeBy(t.flights || [], aiTrip.flights) : t.flights,
           accommodations: aiTrip.accommodations ? mergeBy(t.accommodations || [], aiTrip.accommodations) : t.accommodations,
           transit: aiTrip.transit ? mergeBy(t.transit || [], aiTrip.transit) : t.transit,
           expenses: aiTrip.expenses ? mergeBy(t.expenses || [], aiTrip.expenses) : t.expenses,
           itinerary: mergedItinerary,
           messages: [...(t.messages || []), { id: `ai-${Date.now()}`, role: 'assistant', content: localResult.formattedSummary, timestamp: Date.now() } as ChatMessage]
        };
      }));
      
      // Auto-switch tabs
      if (low.includes('split') || low.includes('expense')) setActiveTab('expenses');
      else if (low.includes('flight') || low.includes('hotel') || low.includes('transit')) setActiveTab('bookings');
      else if (low.includes('activity') || low.includes('visit')) setActiveTab('itinerary');
      
    } else {
      // Command not recognized - give smart hints
      let hint = "I couldn't understand that command. Type 'help' to see available commands, or use the + buttons in each tab to add items manually.";
      
      if (low.includes('book') || low.includes('reserve')) {
        hint = "💡 Try a more specific command like:\n• 'flight Montreal to Paris July 15'\n• 'hotel in Paris July 16-25'\n\nOr use the + buttons in the Bookings tab.";
      } else if (low.includes('cost') || low.includes('pay') || low.includes('owe')) {
        hint = "💡 To log expenses, try:\n• 'dinner $80 split equally'\n• 'taxi $45 split between Alice and Bob'\n\nOr click 'Log Transaction' in the Expenses tab.";
      } else if (low.includes('go') || low.includes('see') || low.includes('do')) {
        hint = "💡 To add activities, try:\n• 'visit Louvre Museum July 18 at 10am'\n• 'dinner reservation July 19 at 7pm'\n\nOr use the + button in the Timeline tab.";
      }
      
      const errMsg: ChatMessage = { 
        id: `ai-${Date.now()}`, 
        role: 'assistant', 
        content: hint, 
        timestamp: Date.now() 
      };
      setTrips(prev => prev.map(t => t.id === activeTripId ? { ...t, messages: [...(t.messages || []), errMsg] } : t));
    }

  } catch (e: any) {
    console.error(e);
    const errMsg: ChatMessage = { 
      id: `err-${Date.now()}`, 
      role: 'assistant', 
      content: "Something went wrong processing that command.", 
      timestamp: Date.now() 
    };
    setTrips(prev => prev.map(t => t.id === activeTripId ? { ...t, messages: [...(t.messages || []), errMsg] } : t));
  }
};

  const tripStats = useMemo(() => {
    if (!activeTrip) return null;
    
    const tripCurrency = activeTrip.preferredCurrency || 'CAD';
    
    // Calculate total costs
    let totalFlightCost = 0;
    activeTrip.flights?.forEach(f => {
      if (f.cost) totalFlightCost += convertCurrency(f.cost, f.currency || tripCurrency, tripCurrency);
    });
    
    let totalAccommodationCost = 0;
    activeTrip.accommodations?.forEach(a => {
      if (a.cost) totalAccommodationCost += convertCurrency(a.cost, a.currency || tripCurrency, tripCurrency);
    });
    
    let totalTransitCost = 0;
    activeTrip.transit?.forEach(t => {
      if (t.cost) totalTransitCost += convertCurrency(t.cost, t.currency || tripCurrency, tripCurrency);
    });
    
    let totalExpenses = 0;
    activeTrip.expenses?.filter(e => e.category !== 'debt').forEach(e => {
      totalExpenses += convertCurrency(e.amount, e.currency, tripCurrency);
    });
    
    const totalCost = totalFlightCost + totalAccommodationCost + totalTransitCost + totalExpenses;
    const costPerPerson = activeTrip.travellers.length > 0 ? totalCost / activeTrip.travellers.length : 0;
    
    // Calculate booking status
    const totalFlights = activeTrip.flights?.length || 0;
    const confirmedFlights = activeTrip.flights?.filter(f => f.status === 'confirmed' || f.status === 'checked-in').length || 0;
    
    const totalStays = activeTrip.accommodations?.length || 0;
    const bookedStays = activeTrip.accommodations?.filter(a => a.isBooked).length || 0;
    
    const totalTransit = activeTrip.transit?.length || 0;
    const bookedTransit = activeTrip.transit?.filter(t => t.isBooked).length || 0;
    
    // Days until trip
    let daysUntil = null;
    if (activeTrip.startDate) {
      const start = new Date(activeTrip.startDate);
      const today = new Date();
      const diffTime = start.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      daysUntil = diffDays;
    }
    
    return {
      totalCost,
      costPerPerson,
      totalFlights,
      confirmedFlights,
      totalStays,
      bookedStays,
      totalTransit,
      bookedTransit,
      daysUntil,
      breakdown: {
        flights: totalFlightCost,
        accommodation: totalAccommodationCost,
        transit: totalTransitCost,
        expenses: totalExpenses
      }
    };
  }, [activeTrip]);

  const debtSummary = useMemo(() => {
  if (!activeTrip || !activeTrip.travellers?.length) return [];
  
  const tripCurrency = activeTrip.preferredCurrency || 'CAD';
  const grossBalances: Record<string, number> = {};
  activeTrip.travellers.forEach(t => grossBalances[t.id] = 0);
  
  activeTrip.expenses.filter(e => e.category !== 'debt').forEach(exp => {
    const participants = exp.participantsTravellerIds?.length ? exp.participantsTravellerIds : activeTrip.travellers.map(t => t.id);
    
    // Convert expense amount to trip currency
    const convertedAmount = convertCurrency(exp.amount, exp.currency, tripCurrency);
    
    if (grossBalances[exp.paidByTravellerId] !== undefined) {
      grossBalances[exp.paidByTravellerId] += convertedAmount;
    }
    
    participants.forEach(pid => { 
      if (grossBalances[pid] !== undefined) {
        let share = 0;
        if (exp.splits && exp.splits.length > 0) {
          const originalShare = exp.splits.find(sp => sp.travellerId === pid)?.amount || 0;
          share = convertCurrency(originalShare, exp.currency, tripCurrency);
        } else {
          share = convertedAmount / Math.max(1, participants.length);
        }
        grossBalances[pid] -= share; 
      }
    });
  });
  
  const settledBalances: Record<string, number> = {};
  activeTrip.travellers.forEach(t => settledBalances[t.id] = 0);
  activeTrip.expenses.filter(e => e.category === 'debt').forEach(exp => {
    const participants = exp.participantsTravellerIds?.length ? exp.participantsTravellerIds : activeTrip.travellers.map(t => t.id);
    const convertedAmount = convertCurrency(exp.amount, exp.currency, tripCurrency);
    
    if (settledBalances[exp.paidByTravellerId] !== undefined) {
      settledBalances[exp.paidByTravellerId] += convertedAmount;
    }
    participants.forEach(pid => {
      if (settledBalances[pid] !== undefined) {
        let share = 0;
        if (exp.splits && exp.splits.length > 0) {
          const originalShare = exp.splits.find(sp => sp.travellerId === pid)?.amount || 0;
          share = convertCurrency(originalShare, exp.currency, tripCurrency);
        } else {
          share = convertedAmount / Math.max(1, participants.length);
        }
        settledBalances[pid] -= share;
      }
    });
  });

  const simplify = (balMap: Record<string, number>) => {
    const result = [];
    const creds = Object.entries(balMap).filter(([_,b]) => b > 0.01).sort((a,b)=>b[1]-a[1]);
    const debts = Object.entries(balMap).filter(([_,b]) => b < -0.01).sort((a,b)=>a[1]-b[1]);
    let d=0, c=0;
    const tempDebts = [...debts], tempCreds = [...creds];
    while(d < tempDebts.length && c < tempCreds.length) {
      const amount = Math.min(-tempDebts[d][1], tempCreds[c][1]);
      result.push({
        fromId: tempDebts[d][0],
        toId: tempCreds[c][0],
        amount: parseFloat(amount.toFixed(2))
      });
      tempDebts[d] = [tempDebts[d][0], tempDebts[d][1] + amount];
      tempCreds[c] = [tempCreds[c][0], tempCreds[c][1] - amount];
      if(tempDebts[d][1] > -0.01) d++;
      if(tempCreds[c][1] < 0.01) c++;
    }
    return result;
  };

  const grossList = simplify(grossBalances);
  const settledList = simplify(settledBalances);

  return grossList.map(item => {
    const match = settledList.find(s => s.fromId === item.toId && s.toId === item.fromId && Math.abs(s.amount - item.amount) < 1);
    return {
      ...item,
      from: activeTrip.travellers.find(t => t.id === item.fromId)?.name || '?',
      to: activeTrip.travellers.find(t => t.id === item.toId)?.name || '?',
      isSettled: !!match
    };
  });
}, [activeTrip]);

  const consolidatedTimeline = useMemo(() => {
    if (!activeTrip) return [];
    const timeline: any[] = [];
    (activeTrip.flights || []).forEach(f => {
    
  const origin = f.departureAirport || f.departureCity || 'TBD';
  const dest = f.arrivalAirport || f.arrivalCity || 'TBD';
  const details = `${f.airline || 'Flight'} | ${f.flightNumber || 'TBD'}`;

  const est = computeEstimatedArrival(f);
  const landingTime = f.arrivalTime || est?.arrivalTimeDisplay; // ✅ fallback to calculated time
  const landingDate = f.arrivalDate || est?.arrivalDate || f.departureDate || '';

  // Departure event
  timeline.push({
    id: `${f.id}-dep`,
    date: f.departureDate || '',
    title: `Flight: ${origin} → ${dest}`,
    type: 'flight',
    details,
    time: f.departureTime,
    category: 'travel'
  });

  // Landing event
  if (landingDate || landingTime) {
    timeline.push({
      id: `${f.id}-arr`,
      date: landingDate,
      title: `Landing: ${dest}`,
      type: 'flight',
      details,
      time: landingTime, // ✅ will show even if you never typed arrivalTime
      category: 'travel'
    });
  }
});
    (activeTrip.accommodations || []).forEach(a => {
      if (a.checkInDate) timeline.push({ id: (a.id as string) + '-in', date: a.checkInDate, title: `Check-in: ${a.name}`, type: 'stay', details: a.address, time: a.checkInTime || '15:00', category: 'rest' });
      if (a.checkOutDate) timeline.push({ id: (a.id as string) + '-out', date: a.checkOutDate, title: `Check-out: ${a.name}`, type: 'stay', details: a.address, time: a.checkOutTime || '11:00', category: 'rest' });
    });
    (activeTrip.transit || []).forEach(ts => {
      const from = ts.from || 'TBD';
      const to = ts.to || 'TBD';
      timeline.push({ id: ts.id, date: ts.departureDate || '', title: `${ts.type.toUpperCase()}: ${from} → ${to}`, type: 'transit', transitType: ts.type, details: ts.operator, time: ts.departureTime, category: 'travel' });
    });
    (activeTrip.itinerary || []).forEach(day => (day.items || []).forEach(it => timeline.push({ ...it, date: it.date || day.date, type: 'activity' })));
    return timeline.sort((a, b) => getSortValue(a).localeCompare(getSortValue(b)));
  }, [activeTrip]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [activeTrip?.messages, isProcessing]);

  return (
    <div 
      className="flex flex-col md:flex-row md:h-screen bg-[#FDFDFD] md:overflow-hidden min-h-screen text-slate-900 antialiased font-['Inter']"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <aside
  className={`bg-white border-r border-slate-100 flex flex-col shadow-sm z-50
  ${showSidebar ? 'fixed inset-0 w-full h-full flex' : 'hidden'}
  lg:static lg:inset-auto lg:w-80 lg:h-auto lg:flex`}
>
        <div className="p-8 flex items-center justify-between">
  <h1 className="text-3xl font-black italic tracking-tighter flex items-center gap-2 text-sky-600">
    <Compass className="w-8 h-8" /> TripHub
  </h1>

  {/* Mobile close */}
  <button
    onClick={() => setShowSidebar(false)}
    className="lg:hidden p-2 rounded-xl bg-slate-100 text-slate-600"
  >
    <X className="w-5 h-5" />
  </button>
</div>
        <div className="flex-1 overflow-y-auto px-6 space-y-2 custom-scrollbar">
          <div className="flex justify-between items-center mb-4"><h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Trips</h2><button onClick={(e) => { e.stopPropagation(); handleCreateTrip("New Trip"); }} className="p-2 bg-slate-900 text-white rounded-lg hover:scale-105 active:scale-95 transition-all"><Plus className="w-4 h-4" /></button></div>
          {trips.map(trip => (
            <div
  key={trip.id}
  onClick={() => {
    setActiveTripId(trip.id);
    setShowSidebar(false);
  }}
  className={`p-4 rounded-2xl cursor-pointer border transition-all flex items-center justify-between group ${activeTripId === trip.id ? 'bg-white border-sky-100 shadow-xl text-sky-600' : 'bg-transparent border-transparent hover:bg-slate-50 text-slate-400'}`}>
              <div className="flex items-center gap-3 overflow-hidden">
                <MapPin className="w-4 h-4 shrink-0" /> 
                <span className="font-black text-xs uppercase max-w-[180px] truncate block">{trip.name}</span>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={(e) => handleCopyTrip(e, trip.id)} className="p-1 hover:text-sky-500 transition-colors" title="Copy trip"><Bookmark className="w-3.5 h-3.5" /></button>
                <button onClick={(e) => handleDeleteTrip(e, trip.id)} className="p-1 hover:text-rose-500 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      </aside>

      <main className="flex-1 flex flex-col md:overflow-hidden min-h-0">
        {activeTrip ? (
          <div className="flex-1 flex flex-col md:flex-row md:overflow-hidden">
            <div className={`w-full md:w-[400px] ${isChatCollapsed ? 'h-auto' : 'h-[60dvh]'} md:h-full shrink-0 flex flex-col border-b md:border-b-0 md:border-r border-slate-50 bg-white shadow-sm z-40 md:static transition-[height] duration-300 ease-in-out`}>
              <div className="p-4 md:p-6 border-b border-slate-50 flex items-center justify-between bg-white relative z-50">
  <div className="flex items-center gap-3 flex-1 min-w-0">
     <button 
       onClick={() => setShowSidebar(true)}
       className="lg:hidden p-1.5 rounded-lg bg-slate-50 text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-all shrink-0"
     >
       <LayoutGrid className="w-4 h-4" />
     </button>
     <button 
       onClick={() => setIsChatCollapsed(!isChatCollapsed)}
       className="md:hidden p-1.5 rounded-lg bg-slate-50 text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-all shrink-0"
     >
       <ChevronRight className={`w-4 h-4 transition-transform duration-300 ${isChatCollapsed ? 'rotate-90' : '-rotate-90'}`} />
     </button>
     <h2 className="text-lg font-black uppercase italic truncate flex-1">{activeTrip.name}</h2>
  </div>
  <div className="flex items-center gap-2">
    {activeTrip.messages && activeTrip.messages.length > 0 && (
      <button 
        onClick={handleClearChat} 
        className="p-1.5 text-slate-300 hover:text-rose-500 transition-colors"
        title="Clear chat"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    )}
    <button onClick={() => setActiveModal('trip')} className="text-slate-300 hover:text-slate-900 transition-colors"><Edit2 className="w-4 h-4" /></button>
  </div>
</div>
              
              <div className={`flex-col flex-1 overflow-hidden ${isChatCollapsed ? 'hidden md:flex' : 'flex'}`}>
                  <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/20 custom-scrollbar">
  {(activeTrip.messages || []).map(msg => (
    <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-2`}>
      <div className={`max-w-[90%] rounded-[2rem] p-4 text-xs font-semibold shadow-sm ${msg.role === 'user' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-100 text-slate-700'}`}>
        {msg.content}
      </div>
      <span className={`text-[9px] font-medium mt-1 px-2 ${msg.role === 'user' ? 'text-slate-400' : 'text-slate-400'}`}>
        {formatTimestamp(msg.timestamp)}
      </span>
    </div>
  ))}
</div>
                  <div className="p-3 md:p-6 border-t border-slate-100 bg-white sticky bottom-0 z-20 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                    <div className="mb-4">
                      <button 
                        onClick={() => setShowExamples(!showExamples)}
                        className="md:hidden w-full py-2 mb-2 bg-slate-100 text-slate-600 rounded-lg text-[9px] font-black uppercase"
                      >
                        {showExamples ? '▼ Hide' : '▶ Show'} Examples
                      </button>
                      
                      <div className={`flex-wrap gap-2 ${showExamples ? 'flex' : 'hidden'} md:flex`}>
                        {exampleChips.map((chip, idx) => (
                          <button 
                            key={idx} 
                            onClick={() => {
                              handleSendMessage(chip);
                              setShowExamples(false);
                            }} 
                            className="px-3 py-1.5 bg-slate-50 hover:bg-sky-50 hover:text-sky-600 border text-[9px] font-black uppercase rounded-lg transition-all"
                          >
                            {chip}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="relative">
                      <textarea 
                        value={inputText} 
                        onChange={e => setInputText(e.target.value)} 
                        onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendMessage())} 
                        placeholder="Type a command: flight, hotel, expense, activity..." 
                        className="w-full pl-6 pr-14 py-4 bg-slate-50 border rounded-2xl text-xs font-semibold h-24 resize-none outline-none focus:bg-white transition-all shadow-inner"
                        style={{ fontSize: '16px' }} // Prevents iOS zoom on focus
                      />
                      <button onClick={() => handleSendMessage()} disabled={isProcessing || !inputText.trim()} className="absolute right-3 bottom-3 p-3 bg-slate-900 text-white rounded-xl shadow-lg hover:bg-sky-600 active:scale-95 disabled:opacity-50 transition-all"><Send className="w-4 h-4" /></button>
                    </div>
                  </div>
              </div>
            </div>

            <div className="flex-1 flex flex-col bg-[#FDFDFD] md:overflow-hidden">
              <div className="flex px-4 md:px-10 border-t md:border-t-0 md:border-b border-slate-50 bg-white/95 shrink-0 z-30 overflow-x-auto no-scrollbar fixed bottom-0 left-0 right-0 md:static">
                {(['itinerary', 'bookings', 'expenses', 'details'] as const).map(tab => (<button key={tab} onClick={() => setActiveTab(tab)} className={`py-6 text-[10px] font-black uppercase tracking-[0.2em] border-b-2 px-8 transition-all shrink-0 ${activeTab === tab ? 'border-sky-600 text-sky-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>{tab}</button>))}
              </div>
              <div className="flex-1 p-4 md:p-10 custom-scrollbar md:overflow-y-auto pb-32 md:pb-10">
                {activeTab === 'bookings' && (
                  <div className="max-w-5xl mx-auto space-y-16 animate-in fade-in">
                    <section>
                      <div className="flex justify-between items-center mb-8">
                        <h3 className="text-2xl font-black uppercase italic flex items-center gap-3"><Plane className="w-7 h-7 text-sky-500" /> Flights</h3>
                        <button onClick={() => setActiveModal('flight')} className="p-2 bg-slate-900 text-white rounded-lg shadow-lg hover:scale-110 active:scale-95 transition-all"><Plus className="w-4 h-4" /></button>
                      </div>
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">{activeTrip.flights?.map(f => <FlightCard key={f.id} flight={f} travellers={activeTrip.travellers} currencySymbol={currencySymbol} onEdit={handleEditLocal} onDelete={(id) => handleDeleteItem('flight', id)} />)}</div>
                    </section>
                    <section>
                      <div className="flex justify-between items-center mb-8">
                        <h3 className="text-2xl font-black uppercase italic flex items-center gap-3"><Hotel className="w-7 h-7 text-indigo-500" /> Accommodation</h3>
                        <button onClick={() => setActiveModal('stay')} className="p-2 bg-slate-900 text-white rounded-lg shadow-lg hover:scale-110 active:scale-95 transition-all"><Plus className="w-4 h-4" /></button>
                      </div>
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">{activeTrip.accommodations?.map(a => <StayCard key={a.id} stay={a} currencySymbol={currencySymbol} onEdit={handleEditLocal} onDelete={(id) => handleDeleteItem('accommodation', id)} />)}</div>
                    </section>
                    <section>
                      <div className="flex justify-between items-center mb-8">
                        <h3 className="text-2xl font-black uppercase italic flex items-center gap-3"><Ship className="w-7 h-7 text-emerald-500" /> Transit</h3>
                        <div className="flex gap-2">
                          <div className="flex bg-slate-100 p-1 rounded-xl">
                            {(['all', 'train', 'ferry', 'bus'] as const).map(f => (
                              <button key={f} onClick={() => setTransitFilter(f)} className={`px-3 py-1 text-[8px] font-black uppercase rounded-lg transition-all ${transitFilter === f ? 'bg-white shadow-sm text-emerald-600' : 'text-slate-400'}`}>{f}</button>
                            ))}
                          </div>
                          <button onClick={() => setActiveModal('transit')} className="p-2 bg-slate-900 text-white rounded-lg shadow-lg hover:scale-110 active:scale-95 transition-all"><Plus className="w-4 h-4" /></button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                        {activeTrip.transit?.filter(ts => transitFilter === 'all' || ts.type === transitFilter).map(ts => <TransitCard key={ts.id} transit={ts} currencySymbol={currencySymbol} onEdit={handleEditLocal} onDelete={(id) => handleDeleteItem('transit', id)} />)}
                      </div>
                    </section>
                  </div>
                )}
                {activeTab === 'expenses' && (
                  <div className="max-w-5xl mx-auto space-y-12 animate-in fade-in">
                    <div className="sticky top-0 z-20 bg-[#FDFDFD] -mx-4 px-4 py-4 -mt-4 mb-4 md:static md:bg-transparent md:p-0 md:m-0 md:mb-4 shadow-sm md:shadow-none transition-all">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <h3 className="text-2xl font-black uppercase italic flex items-center gap-3"><Receipt className="w-7 h-7 text-emerald-500" /> Expenses</h3>
                        <button onClick={() => { setEditingItemId(null); setActiveModal('expense'); }} className="w-full sm:w-auto px-6 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-2 hover:bg-emerald-600 transition-all"><Plus className="w-4 h-4" /> Log Transaction</button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pt-4 md:pt-0">
                      
                      {/* Balances Section - moved FIRST in DOM to appear at top on mobile */}
                      <div className="space-y-6 lg:col-start-3 lg:row-start-1">
                        <div className="bg-white rounded-[2.5rem] border p-8 shadow-sm">
                          <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-6 flex items-center gap-2"><Landmark className="w-4 h-4 text-sky-500" /> Balances</h4>
                          <div className="space-y-4">
                            {debtSummary.map((debt, idx) => (
                              <div key={idx} className={`flex flex-col bg-slate-50 p-4 rounded-2xl gap-2 border border-slate-100 transition-all ${debt.isSettled ? 'opacity-50 grayscale' : ''}`}>
                                 <div className="flex items-center justify-between">
                                   <span className={`text-[10px] font-black uppercase text-slate-900 ${debt.isSettled ? 'line-through' : ''}`}>{debt.from}</span>
                                   <div className="flex-1 mx-4 h-px bg-slate-200 relative"><div className="absolute right-0 top-1/2 -translate-y-1/2 rotate-45 border-t border-r w-1 h-1 border-slate-400"></div></div>
                                   <span className={`text-[10px] font-black uppercase text-sky-600 ${debt.isSettled ? 'line-through' : ''}`}>{debt.to}</span>
                                 </div>
                                 <div className="flex justify-between items-center">
                                    <span className={`text-sm font-black text-slate-900 ${debt.isSettled ? 'line-through' : ''}`}>{currencySymbol}{debt.amount}</span>
                                    {debt.isSettled ? (
                                        <span className="text-[8px] font-black uppercase text-emerald-600 border border-emerald-200 bg-emerald-50 px-2 py-1 rounded">Settled</span>
                                    ) : (
                                        <button onClick={() => {
                                          handleManualAdd('expense', {
                                            title: `Settlement: ${debt.from} to ${debt.to}`,
                                            amount: debt.amount,
                                            paidByTravellerId: debt.fromId,
                                            participantsTravellerIds: [debt.toId],
                                            splitMethod: 'exact',
                                            splits: [{ travellerId: debt.toId, amount: debt.amount }],
                                            category: 'debt'
                                          });
                                        }} className="text-[8px] font-black uppercase text-sky-600 hover:underline">Mark Settled</button>
                                    )}
                                 </div>
                              </div>
                            ))}
                            {debtSummary.length === 0 && <p className="text-[10px] font-black text-slate-300 uppercase italic text-center py-6">Perfectly balanced!</p>}
                          </div>
                          {debtSummary.some(d => !d.isSettled) && (
                            <button onClick={() => {
                              debtSummary.filter(d => !d.isSettled).forEach(d => {
                                handleManualAdd('expense', {
                                  title: `Final Settlement: ${d.from} to ${d.to}`,
                                  amount: d.amount,
                                  paidByTravellerId: d.fromId,
                                  participantsTravellerIds: [d.toId],
                                  splitMethod: 'exact',
                                  splits: [{ travellerId: d.toId, amount: d.amount }],
                                  category: 'debt'
                                });
                              });
                            }} className="w-full mt-6 py-3 bg-slate-900 text-white rounded-xl text-[9px] font-black uppercase">Settle All</button>
                          )}
                        </div>
                      </div>

                      {/* Expenses List */}
                      <div className="lg:col-span-2 lg:col-start-1 lg:row-start-1 space-y-6">
                        {activeTrip.expenses?.map(exp => {
                          const participants = exp.participantsTravellerIds?.length ? exp.participantsTravellerIds : activeTrip.travellers.map(t => t.id);
                          const payer = activeTrip.travellers.find(t => t.id === exp.paidByTravellerId);
                          return (
                            <div key={exp.id} className="bg-white p-6 rounded-[2rem] border shadow-sm flex flex-col gap-4 group hover:shadow-md transition-all">
                              <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center font-black text-lg">{currencySymbol}</div>
                                <div className="flex-1">
                                  <h4 className="font-black text-sm uppercase text-slate-900">{exp.title}</h4>
                                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Paid by {payer?.name || 'Unknown'}</p>
                                </div>
                                <div className="text-right">
  <p className="text-xl font-black text-slate-900">{exp.amount.toFixed(2)}</p>
  {exp.currency !== activeTrip.preferredCurrency && (
    <p className="text-[9px] font-bold text-slate-400">
      ≈ {currencySymbol}{convertCurrency(exp.amount, exp.currency, activeTrip.preferredCurrency).toFixed(2)}
    </p>
  )}
  <div className="flex items-center gap-2 justify-end">

                                    <button onClick={() => { setEditingItemId(exp.id); setActiveModal('expense'); }} className="text-slate-300 hover:text-sky-500 transition-colors"><Edit2 className="w-3 h-3" /></button>
                                    <button onClick={() => handleDeleteItem('expense', exp.id)} className="text-slate-300 hover:text-rose-400 transition-colors"><Trash2 className="w-3 h-3" /></button>
                                  </div>
                                </div>
                              </div>
                              <div className="pt-4 border-t border-slate-50 flex flex-wrap gap-2">
  {participants.map(pid => {
    const tr = activeTrip.travellers.find(t => t.id === pid);
    if (!tr) return null;
    let pAmt = 0;
    if (exp.splits && exp.splits.length > 0) {
      pAmt = exp.splits.find(s => s.travellerId === pid)?.amount || 0;
    } else {
      pAmt = exp.amount / participants.length;
    }
    
    // Convert to trip currency if needed
    const convertedAmt = exp.currency !== activeTrip.preferredCurrency 
      ? convertCurrency(pAmt, exp.currency, activeTrip.preferredCurrency)
      : pAmt;
    
    return (
      <div key={pid} className="px-3 py-1 bg-slate-50 rounded-full text-[9px] font-bold text-slate-500">
        {tr.name}: {exp.currency !== activeTrip.preferredCurrency ? (
          <>
            <span className="opacity-60">{CURRENCIES.find(c => c.code === exp.currency)?.symbol || ''}{pAmt.toFixed(2)}</span>
            <span className="mx-1">≈</span>
            <span>{currencySymbol}{convertedAmt.toFixed(2)}</span>
          </>
        ) : (
          <span>{currencySymbol}{pAmt.toFixed(2)}</span>
        )}
      </div>
    );
  })}
</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
                {activeTab === 'itinerary' && (
                  <div className="max-w-2xl mx-auto py-10 animate-in fade-in">
                    <div className="flex justify-between items-center mb-12">
                      <h3 className="text-2xl font-black uppercase italic tracking-tighter">Timeline</h3>
                      <button onClick={() => setActiveModal('activity')} className="p-3 bg-slate-900 text-white rounded-2xl shadow-xl hover:scale-110 active:scale-95 transition-all"><Plus className="w-5 h-5" /></button>
                    </div>
                    <div className="relative border-l-2 border-slate-100 ml-6 pl-12 space-y-16 md:space-y-16 space-y-8">
                      {consolidatedTimeline.map((item) => (
                        <div key={item.id} className="relative group">
                          <div className={`absolute -left-[68px] top-0 w-10 h-10 rounded-2xl flex items-center justify-center border-4 border-white shadow-xl transition-all ${item.isCompleted ? 'bg-slate-200 text-slate-400 grayscale' : (item.type === 'flight' ? 'bg-sky-500 text-white' : item.type === 'stay' ? 'bg-indigo-500 text-white' : item.type === 'transit' ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white')}`}>
                            {item.type === 'transit' ? (
                                item.transitType === 'ferry' ? <Ship className="w-4 h-4" /> : 
                                item.transitType === 'train' ? <Train className="w-4 h-4" /> : 
                                item.transitType === 'bus' ? <Bus className="w-4 h-4" /> :
                                <Navigation className="w-4 h-4" />
                            ) : getActivityIcon(item.category || 'other')}
                          </div>
                          <div className="flex items-start justify-between gap-6">
                            <div className="flex-1">
                              <p className="text-[9px] font-black uppercase text-sky-600 mb-2">{formatDateDisplay(item.date)} {(item.time || item.startTime) && `@ ${formatTime12h(item.time || item.startTime)}`}</p>
                              <h4 className={`text-xl font-black text-slate-900 uppercase tracking-tight leading-tight ${item.isCompleted ? 'line-through opacity-40' : ''}`}>{item.title}</h4>
                              <p className="text-xs font-medium text-slate-400 mt-2">{item.details || item.location}</p>
                              {item.notes && <p className="text-[10px] text-slate-400 mt-1 italic opacity-60">“{item.notes}”</p>}
                            </div>
                            <div className="flex flex-col items-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => handleEditLocal(item.id, 'isCompleted', !item.isCompleted)} className={`p-2 rounded-xl transition-all ${item.isCompleted ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400 hover:bg-emerald-50 hover:text-emerald-500'}`}><Check className="w-4 h-4"/></button>
                              <button onClick={() => handleDeleteItem('activity', item.id)} className="p-2 bg-slate-100 text-slate-400 hover:bg-rose-50 hover:text-rose-500 rounded-xl transition-all"><Trash2 className="w-4 h-4"/></button>
                            </div>
                          </div>
                        </div>))}
                      {consolidatedTimeline.length === 0 && (
                        <div className="text-center py-20 italic bg-slate-50 rounded-[3rem] border border-dashed border-slate-200">
                          <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Nothing on the radar yet.</p>
                          <button onClick={() => setActiveModal('activity')} className="mt-4 text-[10px] font-black uppercase text-sky-500 hover:underline">Add Activity Manually</button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {activeTab === 'details' && (
                  <div className="max-w-2xl mx-auto space-y-12 animate-in fade-in">
                    {/* Trip Stats Dashboard */}
                    {tripStats && (
                      <section className="bg-gradient-to-br from-sky-50 to-indigo-50 p-8 rounded-[3rem] border border-sky-100 shadow-xl">
                        <h3 className="text-xs font-black uppercase text-slate-400 tracking-widest mb-6 flex items-center gap-2">
                          <PieChart className="w-5 h-5 text-sky-500" /> Trip Overview
                        </h3>
                        
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                          <div className="bg-white p-4 rounded-2xl shadow-sm border border-sky-100">
                            <p className="text-[8px] font-black uppercase text-slate-400 mb-1">Total Cost</p>
                            <p className="text-2xl font-black text-slate-900">{currencySymbol}{tripStats.totalCost.toFixed(0)}</p>
                          </div>
                          
                          <div className="bg-white p-4 rounded-2xl shadow-sm border border-sky-100">
                            <p className="text-[8px] font-black uppercase text-slate-400 mb-1">Per Person</p>
                            <p className="text-2xl font-black text-emerald-600">{currencySymbol}{tripStats.costPerPerson.toFixed(0)}</p>
                          </div>
                          
                          {tripStats.daysUntil !== null && (
                            <div className="bg-white p-4 rounded-2xl shadow-sm border border-sky-100">
                              <p className="text-[8px] font-black uppercase text-slate-400 mb-1">
                                {tripStats.daysUntil > 0 ? 'Days Until' : tripStats.daysUntil === 0 ? 'Today!' : 'Days Ago'}
                              </p>
                              <p className="text-2xl font-black text-sky-600">{Math.abs(tripStats.daysUntil)}</p>
                            </div>
                          )}
                          
                          <div className="bg-white p-4 rounded-2xl shadow-sm border border-sky-100">
                            <p className="text-[8px] font-black uppercase text-slate-400 mb-1">Bookings</p>
                            <p className="text-2xl font-black text-indigo-600">
                              {tripStats.confirmedFlights + tripStats.bookedStays + tripStats.bookedTransit}/
                              {tripStats.totalFlights + tripStats.totalStays + tripStats.totalTransit}
                            </p>
                          </div>
                        </div>
                        
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-sky-100">
                          <p className="text-[8px] font-black uppercase text-slate-400 mb-4">Cost Breakdown</p>
                          <div className="space-y-3">
                            {tripStats.breakdown.flights > 0 && (
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] font-bold text-slate-600 flex items-center gap-2">
                                  <Plane className="w-3 h-3 text-sky-500"/> Flights
                                </span>
                                <span className="text-sm font-black text-slate-900">{currencySymbol}{tripStats.breakdown.flights.toFixed(0)}</span>
                              </div>
                            )}
                            {tripStats.breakdown.accommodation > 0 && (
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] font-bold text-slate-600 flex items-center gap-2">
                                  <Hotel className="w-3 h-3 text-indigo-500"/> Accommodation
                                </span>
                                <span className="text-sm font-black text-slate-900">{currencySymbol}{tripStats.breakdown.accommodation.toFixed(0)}</span>
                              </div>
                            )}
                            {tripStats.breakdown.transit > 0 && (
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] font-bold text-slate-600 flex items-center gap-2">
                                  <Ship className="w-3 h-3 text-emerald-500"/> Transit
                                </span>
                                <span className="text-sm font-black text-slate-900">{currencySymbol}{tripStats.breakdown.transit.toFixed(0)}</span>
                              </div>
                            )}
                            {tripStats.breakdown.expenses > 0 && (
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] font-bold text-slate-600 flex items-center gap-2">
                                  <Wallet className="w-3 h-3 text-amber-500"/> Expenses
                                </span>
                                <span className="text-sm font-black text-slate-900">{currencySymbol}{tripStats.breakdown.expenses.toFixed(0)}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </section>
                    )}
                    
                    <section className="bg-white p-12 rounded-[3rem] border shadow-xl">
                      <div className="flex justify-between items-center mb-10">
                        <h3 className="text-xs font-black uppercase text-slate-400 tracking-widest flex items-center gap-3"><Users className="w-5 h-5 text-sky-500" /> Travellers</h3>
                        <div className="flex items-center gap-3 bg-slate-50 p-2 rounded-xl border">
                          <label className="text-[8px] font-black uppercase text-slate-400 px-2 border-r border-slate-200">Currency</label>
                          <select value={activeTrip.preferredCurrency} onChange={e => handleEditLocal('', 'preferredCurrency', e.target.value)} className="text-[10px] font-bold border-none bg-transparent outline-none cursor-pointer">
                            {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code} ({c.symbol})</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="space-y-3">
                        {activeTrip.travellers?.map(t => (<div key={t.id} className="flex items-center justify-between bg-slate-50 p-4 rounded-2xl group border border-transparent hover:border-slate-100 transition-all shadow-sm hover:shadow-md"><span className="text-[10px] font-bold uppercase">{t.name}</span><button onClick={() => handleDeleteItem('traveller', t.id)} className="text-rose-400 opacity-0 group-hover:opacity-100 transition-all hover:scale-110"><Trash2 className="w-4 h-4" /></button></div>))}
                        {isAddingTraveller ? (
                          <div className="flex gap-2 animate-in slide-in-from-left-2">
                            <input autoFocus className="flex-1 bg-white border-2 border-sky-100 rounded-xl px-4 py-3 text-[10px] font-bold outline-none shadow-inner" value={newTravellerName} onChange={e => setNewTravellerName(e.target.value)} onKeyDown={e => e.key === 'Enter' && newTravellerName.trim() && (handleManualAdd('traveller', { name: newTravellerName.trim() }), setNewTravellerName(''), setIsAddingTraveller(false))} />
                            <button onClick={() => { if (newTravellerName.trim()) { handleManualAdd('traveller', { name: newTravellerName.trim() }); setNewTravellerName(''); setIsAddingTraveller(false); } }} className="p-3 bg-sky-600 text-white rounded-xl shadow-lg"><Check className="w-4 h-4" /></button>
                          </div>
                        ) : (<button onClick={() => setIsAddingTraveller(true)} className="w-full py-6 border-2 border-dashed border-slate-200 rounded-[2rem] text-[10px] font-black text-slate-400 uppercase hover:border-slate-400 hover:text-slate-600 transition-all bg-slate-50/50 flex items-center justify-center gap-3"><Plus className="w-5 h-5" /> New Traveller</button>)}
                      </div>
                    </section>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col bg-white">
            {/* Mobile header with hamburger menu */}
            <div className="lg:hidden p-4 border-b border-slate-100 flex items-center justify-between">
              <h1 className="text-xl font-black italic tracking-tighter flex items-center gap-2 text-sky-600">
                <Compass className="w-6 h-6" /> TripHub
              </h1>
              <button
                onClick={() => setShowSidebar(true)}
                className="p-2 rounded-xl bg-slate-100 text-slate-600 hover:bg-sky-50 hover:text-sky-600"
              >
                <LayoutGrid className="w-5 h-5" />
              </button>
            </div>
            
            {/* Empty state content */}
            <div className="flex-1 flex flex-col items-center justify-center p-10 text-center animate-in fade-in zoom-in-95">
              <div className="w-32 h-32 bg-sky-50 rounded-full flex items-center justify-center mb-8"><Compass className="w-16 h-16 text-sky-500 opacity-40 animate-pulse" /></div>
              <h2 className="text-3xl font-black italic text-slate-900 uppercase tracking-tighter mb-4">No Trip Selected</h2>
              <p className="text-slate-400 max-w-sm mb-12 text-sm font-medium leading-relaxed">Select an existing trip or create a new one to get started.</p>
              <button onClick={() => setActiveModal('trip')} className="px-12 py-5 bg-sky-600 text-white rounded-[2.5rem] font-black uppercase tracking-widest shadow-2xl hover:bg-sky-700 hover:scale-105 active:scale-95 transition-all flex items-center gap-4">
                <Plus className="w-6 h-6" /> Create New Trip
              </button>
            </div>
          </div>
        )}
      </main>

      <Modal title={activeTrip ? 'Edit Trip Settings' : 'Start a New Trip'} isOpen={activeModal === 'trip'} onClose={() => setActiveModal(null)}>
        <form onSubmit={e => { e.preventDefault(); const fd = new FormData(e.currentTarget); const name = fd.get('name') as string; if (activeTrip) { handleEditLocal('', 'name', name); setActiveModal(null); } else { handleCreateTrip(name); } }} className="space-y-6">
          <div className="space-y-2">
            <label className="text-[9px] font-black text-slate-400 uppercase">Trip Destination Name</label>
            <input name="name" defaultValue={activeTrip?.name} className="w-full bg-slate-50 rounded-2xl p-4 text-xs font-bold shadow-inner outline-none border focus:border-sky-200 text-slate-900" placeholder="e.g. Summer in Japan" required />
          </div>
          <button type="submit" className="w-full py-5 bg-slate-900 text-white rounded-[2rem] font-black uppercase text-[10px] shadow-xl hover:bg-sky-600 transition-all">{activeTrip ? "Update Name" : "Create Trip"}</button>
        </form>
      </Modal>

      <Modal title="Add Flight" isOpen={activeModal === 'flight'} onClose={() => setActiveModal(null)}>
        <form onSubmit={e => { e.preventDefault(); const fd = new FormData(e.currentTarget); handleManualAdd('flight', { ...Object.fromEntries(fd.entries()), status: 'pending' }); }} className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-1 space-y-1"><label className="text-[8px] font-black uppercase text-slate-400">Airline</label><input name="airline" placeholder="e.g. Delta" className="w-full border p-2 rounded text-xs outline-none focus:border-sky-500 text-slate-900 bg-white" required /></div>
            <div className="col-span-1 space-y-1"><label className="text-[8px] font-black uppercase text-slate-400">Flight #</label><input name="flightNumber" placeholder="DL123" className="w-full border p-2 rounded text-xs outline-none focus:border-sky-500 text-slate-900 bg-white" required /></div>
            <div className="col-span-1 space-y-1"><label className="text-[8px] font-black uppercase text-slate-400">From (Airport)</label><input name="departureAirport" placeholder="JFK" className="w-full border p-2 rounded text-xs outline-none focus:border-sky-500 text-slate-900 bg-white" required /></div>
            <div className="col-span-1 space-y-1"><label className="text-[8px] font-black uppercase text-slate-400">To (Airport)</label><input name="arrivalAirport" placeholder="LHR" className="w-full border p-2 rounded text-xs outline-none focus:border-sky-500 text-slate-900 bg-white" required /></div>
            <div className="col-span-1 space-y-1">
              <label className="text-[8px] font-black uppercase text-slate-400">Dep Date</label>
              <input type="date" name="departureDate" className="w-full border p-2 rounded text-xs text-slate-900 bg-white" required />
            </div>
            <div className="col-span-1 space-y-1">
              <label className="text-[8px] font-black uppercase text-slate-400">Dep Time</label>
              <input type="time" name="departureTime" className="w-full border p-2 rounded text-xs text-slate-900 bg-white" required />
            </div>
            <div className="col-span-1 space-y-1">
              <label className="text-[8px] font-black uppercase text-slate-400">Arr Date</label>
              <input type="date" name="arrivalDate" className="w-full border p-2 rounded text-xs text-slate-900" />
            </div>
            <div className="col-span-1 space-y-1">
              <label className="text-[8px] font-black uppercase text-slate-400">Arr Time</label>
              <input type="time" name="arrivalTime" className="w-full border p-2 rounded text-xs text-slate-900" />
            </div>
            <div className="col-span-2 grid grid-cols-3 gap-2">
               <div className="space-y-1"><label className="text-[8px] font-black uppercase text-slate-400">Terminal</label><input name="terminal" className="w-full border p-2 rounded text-xs text-slate-900" /></div>
               <div className="space-y-1"><label className="text-[8px] font-black uppercase text-slate-400">Gate</label><input name="gate" className="w-full border p-2 rounded text-xs text-slate-900" /></div>
               <div className="space-y-1"><label className="text-[8px] font-black uppercase text-slate-400">Seat</label><input name="seat" className="w-full border p-2 rounded text-xs text-slate-900" /></div>
            </div>
            <div className="col-span-2 space-y-1">
               <label className="text-[8px] font-black uppercase text-slate-400">Traveller</label>
               <select name="travellerId" className="w-full border p-2 rounded text-xs bg-white text-slate-900">
                 <option value="">Select Traveller</option>
                 {activeTrip?.travellers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
               </select>
            </div>
            <div className="col-span-2 space-y-1">
               <label className="text-[8px] font-black uppercase text-slate-400">Booking URL</label>
               <input name="bookingUrl" className="w-full border p-2 rounded text-xs text-slate-900" placeholder="https://" />
            </div>
          </div>
          <button type="submit" className="w-full py-4 bg-sky-600 text-white rounded-[1.5rem] font-black uppercase text-[10px] shadow-lg hover:bg-sky-700 transition-all">Save Flight Details</button>
        </form>
      </Modal>

      <Modal title="Add Accommodation" isOpen={activeModal === 'stay'} onClose={() => setActiveModal(null)}>
        <form onSubmit={e => { e.preventDefault(); const fd = new FormData(e.currentTarget); handleManualAdd('accommodation', { ...Object.fromEntries(fd.entries()), isBooked: false }); }} className="space-y-5">
          <div className="space-y-1"><label className="text-[8px] font-black uppercase text-slate-400">Hotel / Stay Name</label><input name="name" className="w-full border p-3 rounded-xl text-xs text-slate-900 bg-white" required /></div>
          <div className="space-y-1"><label className="text-[8px] font-black uppercase text-slate-400">Address</label><input name="address" className="w-full border p-3 rounded-xl text-xs text-slate-900 bg-white" /></div>
          <div className="grid grid-cols-2 gap-3">
             <div className="space-y-1"><label className="text-[8px] font-black uppercase text-slate-400">Check-in</label><input type="date" name="checkInDate" className="w-full border p-3 rounded-xl text-xs text-slate-900 bg-white" /></div>
             <div className="space-y-1"><label className="text-[8px] font-black uppercase text-slate-400">Time</label><input type="time" name="checkInTime" className="w-full border p-3 rounded-xl text-xs text-slate-900 bg-white" /></div>
             <div className="space-y-1"><label className="text-[8px] font-black uppercase text-slate-400">Check-out</label><input type="date" name="checkOutDate" className="w-full border p-3 rounded-xl text-xs text-slate-900 bg-white" /></div>
             <div className="space-y-1"><label className="text-[8px] font-black uppercase text-slate-400">Time</label><input type="time" name="checkOutTime" className="w-full border p-3 rounded-xl text-xs text-slate-900 bg-white" /></div>
          </div>
          <div className="space-y-1"><label className="text-[8px] font-black uppercase text-slate-400">Booking URL</label><input name="bookingUrl" className="w-full border p-3 rounded-xl text-xs text-slate-900 bg-white" placeholder="https://" /></div>
          <button type="submit" className="w-full py-4 bg-indigo-600 text-white rounded-[1.5rem] font-black uppercase text-[10px] shadow-lg hover:bg-indigo-700 transition-all">Save Accommodation</button>
        </form>
      </Modal>

      <Modal title="Add Transit" isOpen={activeModal === 'transit'} onClose={() => setActiveModal(null)}>
        <form onSubmit={e => { e.preventDefault(); const fd = new FormData(e.currentTarget); handleManualAdd('transit', { ...Object.fromEntries(fd.entries()), isBooked: false }); }} className="space-y-5">
           <div className="space-y-1"><label className="text-[8px] font-black uppercase text-slate-400">Type</label>
             <select name="type" className="w-full border p-3 rounded-xl text-xs bg-white text-slate-900">
                <option value="train">Train</option>
                <option value="ferry">Ferry</option>
                <option value="bus">Bus</option>
                <option value="other">Other</option>
             </select>
           </div>
           <div className="space-y-1"><label className="text-[8px] font-black uppercase text-slate-400">Operator</label><input name="operator" className="w-full border p-3 rounded-xl text-xs text-slate-900 bg-white" required /></div>
           <div className="grid grid-cols-2 gap-3">
             <div className="space-y-1"><label className="text-[8px] font-black uppercase text-slate-400">From</label><input name="from" className="w-full border p-3 rounded-xl text-xs text-slate-900 bg-white" required /></div>
             <div className="space-y-1"><label className="text-[8px] font-black uppercase text-slate-400">To</label><input name="to" className="w-full border p-3 rounded-xl text-xs text-slate-900 bg-white" required /></div>
           </div>
           <div className="grid grid-cols-2 gap-3">
             <div className="space-y-1"><label className="text-[8px] font-black uppercase text-slate-400">Dep Date</label><input type="date" name="departureDate" className="w-full border p-3 rounded-xl text-xs text-slate-900 bg-white" required /></div>
             <div className="space-y-1"><label className="text-[8px] font-black uppercase text-slate-400">Time</label><input type="time" name="departureTime" className="w-full border p-3 rounded-xl text-xs text-slate-900 bg-white" required /></div>
           </div>
           <button type="submit" className="w-full py-4 bg-emerald-600 text-white rounded-[1.5rem] font-black uppercase text-[10px] shadow-lg hover:bg-emerald-700 transition-all">Save Transit</button>
        </form>
      </Modal>

      <Modal title="Add Activity" isOpen={activeModal === 'activity'} onClose={() => setActiveModal(null)}>
        <form onSubmit={e => { e.preventDefault(); const fd = new FormData(e.currentTarget); handleManualAdd('activity', Object.fromEntries(fd.entries())); }} className="space-y-5">
          <div className="space-y-1"><label className="text-[8px] font-black uppercase text-slate-400">Activity Title</label><input name="title" className="w-full border p-3 rounded-xl text-xs text-slate-900 bg-white" required /></div>
          <div className="grid grid-cols-2 gap-3">
             <div className="space-y-1"><label className="text-[8px] font-black uppercase text-slate-400">Date</label><input type="date" name="date" className="w-full border p-3 rounded-xl text-xs text-slate-900 bg-white" required /></div>
             <div className="space-y-1"><label className="text-[8px] font-black uppercase text-slate-400">Time</label><input type="time" name="startTime" className="w-full border p-3 rounded-xl text-xs text-slate-900 bg-white" /></div>
          </div>
           <div className="space-y-1"><label className="text-[8px] font-black uppercase text-slate-400">Category</label>
             <select name="category" className="w-full border p-3 rounded-xl text-xs bg-white text-slate-900">
                <option value="activity">Activity</option>
                <option value="food">Food</option>
                <option value="rest">Rest</option>
                <option value="travel">Travel</option>
             </select>
           </div>
           <div className="space-y-1"><label className="text-[8px] font-black uppercase text-slate-400">Location / Details</label><input name="location" className="w-full border p-3 rounded-xl text-xs text-slate-900 bg-white" /></div>
           <button type="submit" className="w-full py-4 bg-amber-500 text-white rounded-[1.5rem] font-black uppercase text-[10px] shadow-lg hover:bg-amber-600 transition-all">Add to Itinerary</button>
        </form>
      </Modal>

      <Modal title="Log Expense" isOpen={activeModal === 'expense'} onClose={() => setActiveModal(null)}>
        {activeTrip && (
            <ExpenseForm 
              travellers={activeTrip.travellers} 
              currency={activeTrip.preferredCurrency || 'CAD'}
              existingExpense={editingItemId ? activeTrip.expenses.find(e => e.id === editingItemId) : undefined}
              onSubmit={(data) => { 
                if (editingItemId) handleEditLocal(editingItemId, '', data); 
                else handleManualAdd('expense', data); 
                setActiveModal(null); 
              }} 
            />
        )}
      </Modal>
    </div>
  );
};

export default App;
