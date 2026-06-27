/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from "react";
import { BrowserRouter as Router, Routes, Route, Link, useNavigate, useSearchParams } from "react-router-dom";
import { 
  auth, db, signIn as signInWithGoogle, logOut, signUpWithEmail, signInWithEmail, resetPassword,
  onSnapshot, doc, setDoc, getDoc, updateDoc, collection, query, where, addDoc, serverTimestamp, deleteDoc, getDocs, writeBatch,
  handleFirestoreError, OperationType, orderBy, limit
} from "./firebase";
import { supabase } from "./lib/supabase";
import { 
  syncProfileToSupabase,
  syncBoatToSupabase,
  deleteProfileFromSupabase
} from "./lib/sync";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { 
  Waves, Calendar, Users, Shield, CreditCard, LogOut, Menu, X, 
  ChevronRight, CheckCircle2, AlertCircle, Mail, FileText, Anchor, UserMinus, Ticket, Heart,
  Plus, Trash2, Edit, MessageSquare, Zap, Trophy, Wind, Info, MapPin, Search, Upload, Download,
  ChevronDown, ChevronUp, BarChart3, ShieldCheck, Lock, LifeBuoy, Compass, ExternalLink, HelpCircle, History, AlertTriangle, PhoneCall, ShieldAlert,
  RefreshCw, ArrowRight, Baby, UserCircle, Check, Activity as ActivityIcon, List
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, differenceInDays, isWeekend, eachDayOfInterval, addDays } from "date-fns";
import { motion } from "motion/react";

// --- UI Helpers ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const safeJson = async (resp: Response) => {
  const contentType = resp.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    return await resp.json();
  }
  const text = await resp.text();
  console.error("[SafeFetch] Non-JSON response:", text.substring(0, 200));
  throw new Error(`Server returned non-JSON response (${resp.status}). Check console.`);
};

declare global {
  interface Window {
    localOrigin?: string;
  }
}

// --- Types ---
type Role = "guest" | "future_member" | "member" | "leader" | "instructor" | "social" | "financial" | "admin" | "partner_club";
type OnboardingStatus = 
  | "none" 
  | "beginner_pending_payment" 
  | "beginner_paid" 
  | "pending_leader_approval" 
  | "trial_active" 
  | "pro_pending_approval" 
  | "former_pending_payment" 
  | "pool_passed" 
  | "membership_paid";

interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  onboardingStatus: OnboardingStatus;
  abilityProfile?: string;
  membershipExpiry?: any;
  onboardingPath?: "beginner" | "pro" | "former";
  hasAcceptedConduct?: boolean;
  conductAcceptedAt?: any;

  // Basic Info
  firstName?: string;
  lastName?: string;
  yearOfBirth?: number;
  sex?: string;
  mobileNumber?: string;
  
  childCoupons?: number; // Pre-purchased child coupons count
  appliedCouponId?: string; // Current applied coupon
  
  // Address
  houseNameNumberStreet?: string;
  town?: string;
  county?: string;
  postcode?: string;
  
  // Emergency Contact
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelationship?: string;
  
  paddlingLevel?: number; // 1: Beginner, 2: Good, 3: Expert

  // Paddling Info
  yearsPaddling?: string; // Changed to string for dropdown "1", "2", "3", "4", "5", "Over 5"
  britishCanoeingAwards?: string;
  britishCanoeingQualifications?: string;
  britishCanoeingMember?: boolean;
  leeValleyAssessment?: string;
  firstAidSafeguarding?: string;
  navigationQualifications?: string;
  kayakingLeadershipExperience?: string;
  nonKayakingLeadershipExperience?: string;
  training?: string;
  experience?: string;
  paddlingDescription?: string; // New field for pro path
  
  // Interests & Preferences
  newsletter?: boolean;
  interestedInSeaKayaking?: boolean;
  interestedInRacing?: boolean;
  racingDivision?: string;
  includeInDirectory?: boolean;
  excludeFromSpecialMailList?: boolean;
  howDidYouHear?: string;
  
  // Admin Only / Membership Fields
  memberNumber?: string;
  disabilityDetails?: string;
  hasDisability?: boolean; // New field for clickable toggle
  photoUrl?: string;
  keyHolder?: boolean;
  committeeMember?: boolean;
  boatStorage?: string;
  thamesLeader?: boolean;
  leaderTraining?: boolean;
  expiresOn?: any;
  systemEmail?: string;
  renewedOn?: any;
  memberSince?: any;
  linkedTo?: string;
  membershipState?: string;
  membershipType?: string;

  // Approval Info
  poolApprovedBy?: string;
  poolApprovalNotes?: string;
  poolApprovalDate?: any;
  selectedPoolSessionId?: string;
  landlineNumber?: string;
  email2?: string;
  unsubscribeExpiryEmail?: boolean;
  unsubscribeGroupEmail?: boolean;

  // Partner Club Info
  partnerFirstName?: string;
  partnerLastName?: string;
  clubWebsite?: string;
  clubPhone?: string; // This will now be mobile
  clubDescription?: string;
  clubAdultPrice?: number;
  clubChildPrice?: number;
  createdAt?: any;
  bookedSessionDate?: any;
  poolAssessmentNotes?: string;
}

interface ClubEvent {
  id: string;
  title: string;
  description: string;
  date: any;
  type: "pool" | "river" | "social" | "training";
  leaderId: string;
  maxParticipants: number;
  participants: string[];
  location?: string;
  locationAddress?: string; // New field for map
  showMap?: boolean;
  boatId?: string; // Optional linked boat
  allowBoatSelection?: boolean; // New field for boat booking flow
  allowEventCoupon?: boolean; // New field for leader-only coupon bypass
}

interface Coupon {
  id: string;
  code: string;
  type: "instructor" | "child" | "club" | "custom" | "fixed" | "percent" | "one-time";
  used: boolean;
  usedBy?: string;
  usedAt?: any;
  ownerId?: string;
  batchId?: string;
  description?: string;
  value?: number;
  createdAt?: any;
}

interface Boat {
  id: string;
  name: string;
  type: "Sea Kayak" | "Whitewater" | "General Purpose" | "Racing" | "Surfski" | "Canoe" | "SUP" | "Other";
  brand?: string;
  model?: string;
  colour?: string;
  paddlerWeight?: string;
  notes?: string;
  description?: string;
  imageUrl?: string;
  status: "available" | "maintenance" | "rented" | "retired";
  location?: string;
  addedAt: any;
  // Pricing
  costPerDay?: number;
  costPerWeekend?: number;
  costPerDayOver?: number; // Cost per day for long term rentals
  length?: string;
}

interface FeedbackItem {
  id?: string;
  type: "Correction" | "New Idea";
  submitterName: string;
  submitterId: string;
  page?: string;
  locationOnPage?: string;
  currentText?: string;
  suggestedText?: string;
  description?: string;
  isCompleted: boolean;
  adminNote?: string;
  createdAt: any;
  updatedAt?: any;
}

const FeedbackDialog = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
  const { user, profile } = useAuth();
  const [type, setType] = useState<"Correction" | "New Idea">("Correction");
  const [formData, setFormData] = useState({
    page: "",
    locationOnPage: "",
    currentText: "",
    suggestedText: "",
    description: ""
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile) return;
    setIsSubmitting(true);
    try {
      if (db) {
        await addDoc(collection(db, "feedback"), {
          type,
          submitterName: profile.displayName || user.email || "Anonymous",
          submitterId: user.uid,
          ...formData,
          isCompleted: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        alert("Thank you! Your feedback has been submitted.");
        onClose();
        setFormData({ page: "", locationOnPage: "", currentText: "", suggestedText: "", description: "" });
      }
    } catch (error: any) {
      handleFirestoreError(error, OperationType.CREATE, "feedback");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const adminPages = ["Dashboard", "Member Management", "Event Planning", "Financials", "Boat Inventory", "Partner Club Dash"];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[200] flex items-center justify-center p-4">
      <Card className="w-full max-w-xl p-8 animate-in zoom-in-95 duration-200">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-2xl font-black italic">Site <span className="text-emerald-600">Feedback</span></h2>
            <p className="text-slate-500 text-sm">Help us improve the PBCC platform.</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}><X size={20} /></Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex gap-2 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setType("Correction")}
              className={cn("flex-1 py-2 px-4 rounded-md text-sm font-bold transition-all", type === "Correction" ? "bg-white shadow-sm text-emerald-600" : "text-slate-600 hover:text-slate-900")}
            >
              Correction
            </button>
            <button
              type="button"
              onClick={() => setType("New Idea")}
              className={cn("flex-1 py-2 px-4 rounded-md text-sm font-bold transition-all", type === "New Idea" ? "bg-white shadow-sm text-emerald-600" : "text-slate-600 hover:text-slate-900")}
            >
              New Idea
            </button>
          </div>

          {type === "Correction" ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">Page</label>
                  <select 
                    className="w-full p-3 border rounded-xl bg-slate-50 outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm"
                    value={formData.page}
                    onChange={(e) => setFormData({ ...formData, page: e.target.value })}
                    required
                  >
                    <option value="">Select Page...</option>
                    {adminPages.map(p => <option key={p} value={p}>{p}</option>)}
                    <option value="Home">Home</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">Where on Page</label>
                  <input 
                    className="w-full p-3 border rounded-xl bg-slate-50 outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm"
                    placeholder="e.g. Booking modal, Footer, etc."
                    value={formData.locationOnPage}
                    onChange={(e) => setFormData({ ...formData, locationOnPage: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">What it is now</label>
                <textarea 
                  className="w-full p-3 border rounded-xl bg-slate-50 outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm min-h-[80px]"
                  placeholder="Paste current text or describe issue..."
                  value={formData.currentText}
                  onChange={(e) => setFormData({ ...formData, currentText: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">What it should be</label>
                <textarea 
                  className="w-full p-3 border rounded-xl bg-slate-50 outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm min-h-[80px]"
                  placeholder="Tell us the corrected version..."
                  value={formData.suggestedText}
                  onChange={(e) => setFormData({ ...formData, suggestedText: e.target.value })}
                  required
                />
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">Idea Description</label>
              <textarea 
                className="w-full p-3 border rounded-xl bg-slate-50 outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm min-h-[200px]"
                placeholder="Describe your new idea or suggestion..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                required
              />
            </div>
          )}

          <div className="pt-4 flex gap-3">
            <Button variant="ghost" className="flex-1" type="button" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
            <Button className="flex-1 gap-2" type="submit" disabled={isSubmitting}>
              {isSubmitting ? <RefreshCw size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
              Submit to Team
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};

// --- Error Boundary ---
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong.";
      let detail = "";
      try {
        const parsedError = JSON.parse(this.state.error.message);
        if (parsedError.error?.includes("Missing or insufficient permissions")) {
          errorMessage = "You don't have permission to view this content. Please make sure you are signed in and have the correct role.";
        } else {
          errorMessage = "An error occurred: " + (parsedError.error || "Unknown error");
        }
        detail = JSON.stringify(parsedError, null, 2);
      } catch (e) {
        errorMessage = this.state.error?.message || String(this.state.error);
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center space-y-6">
          <AlertCircle className="text-red-500 w-16 h-16" />
          <div className="space-y-2">
            <h2 className="text-3xl font-bold">Oops!</h2>
            <p className="text-slate-600 max-w-md mx-auto">{errorMessage}</p>
          </div>
          {detail && (
            <details className="text-left bg-slate-50 p-4 rounded-xl border border-slate-200 w-full max-w-2xl overflow-auto">
              <summary className="text-xs font-mono cursor-pointer text-slate-500">Technical details</summary>
              <pre className="text-[10px] font-mono mt-4 text-slate-700 whitespace-pre-wrap">{detail}</pre>
            </details>
          )}
          <Button onClick={() => window.location.reload()} className="bg-emerald-600 hover:bg-emerald-700">
            Try Refreshing
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

// --- Auth Context ---
const AuthContext = createContext<{
  user: FirebaseUser | null;
  profile: UserProfile | null;
  loading: boolean;
}>({ user: null, profile: null, loading: true });

const useAuth = () => useContext(AuthContext);

// --- UI Context ---
interface UIContextType {
  confirm: (message: string, onConfirm: () => void) => void;
  alert: (message: string) => void;
  showReceipt: (url: string) => void;
  openPaymentTask: (url: string) => void;
}
const UIContext = createContext<UIContextType>({
  confirm: () => {},
  alert: () => {},
  showReceipt: () => {},
  openPaymentTask: () => {},
});
const useUI = () => useContext(UIContext);

// --- Stripe Payment Handler ---
const openPaymentUrl = (url: string) => {
  console.log("[Stripe v2.4] Event Triggered:", url);
  window.dispatchEvent(new CustomEvent("STRIPE_REDIRECT_REQUESTED", { detail: { url } }));
};

// --- Google Drive Integration removed ---

const ReceiptBadge = ({ url }: { url: string }) => {
  if (!url) return null;
  return (
    <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100 flex items-center justify-between">
      <span className="text-xs text-emerald-700 font-medium flex items-center gap-2">
        <CheckCircle2 size={14} /> Receipt linked: {url.length > 20 ? url.substring(0, 20) + "..." : url}
      </span>
    </div>
  );
};

const Accordion = ({ title, children, defaultOpen = false, icon: Icon }: { title: string, children: React.ReactNode, defaultOpen?: boolean, icon?: any }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm hover:shadow-md transition-all">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-4 flex items-center justify-between bg-white hover:bg-slate-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          {Icon && <Icon size={20} className="text-emerald-600" />}
          <span className="font-bold text-slate-900">{title}</span>
        </div>
        <ChevronDown size={20} className={cn("text-slate-400 transition-transform", isOpen && "rotate-180")} />
      </button>
      <motion.div 
        initial={false}
        animate={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }}
        className="overflow-hidden"
      >
        <div className="p-4 border-t border-slate-100 bg-slate-50/30">
          {children}
        </div>
      </motion.div>
    </div>
  );
};

const Button = ({ className, variant = "primary", size = "md", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "outline" | "ghost" | "danger", size?: "sm" | "md" | "lg" }) => {
  const variants = {
    primary: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm",
    secondary: "bg-slate-800 text-white hover:bg-slate-900",
    outline: "border border-slate-200 text-slate-700 hover:bg-slate-50",
    ghost: "text-slate-600 hover:bg-slate-100",
    danger: "bg-red-600 text-white hover:bg-red-700",
  };
  const sizes = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2",
    lg: "px-6 py-3 text-lg",
  };
  return (
    <button 
      className={cn("inline-flex items-center justify-center rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed", variants[variant], sizes[size], className)} 
      {...props} 
    />
  );
};

const Card = ({ children, className, onClick }: { children: React.ReactNode, className?: string, onClick?: () => void }) => (
  <div 
    onClick={onClick}
    className={cn("bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden", className)}
  >
    {children}
  </div>
);

const Badge = ({ children, variant = "default", className }: { children: React.ReactNode, variant?: "default" | "success" | "warning" | "info" | "destructive" | "secondary", className?: string }) => {
  const variants = {
    default: "bg-slate-100 text-slate-700",
    success: "bg-emerald-100 text-emerald-700",
    warning: "bg-amber-100 text-amber-700",
    info: "bg-blue-100 text-blue-700",
    destructive: "bg-red-100 text-red-700",
    secondary: "bg-slate-600 text-white"
  };
  return <span className={cn("px-2 py-0.5 rounded-full text-xs font-semibold", variants[variant], className)}>{children}</span>;
};

// --- Pages ---

const Boats = () => {
  const { user, profile, loading: authLoading } = useAuth();
  const [boats, setBoats] = useState<Boat[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingBoat, setEditingBoat] = useState<Boat | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<Boat["type"] | "All">("All");
  const [selectedBoatForRental, setSelectedBoatForRental] = useState<Boat | null>(null);
  const [isRentModalOpen, setIsRentModalOpen] = useState(false);
  const [rentalDates, setRentalDates] = useState<{ start: string; end: string }>({
    start: format(new Date(), "yyyy-MM-dd"),
    end: format(addDays(new Date(), 1), "yyyy-MM-dd")
  });
  const [includeRentalExtras, setIncludeRentalExtras] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    
    let unsubscribe = () => {};

    if (db) {
      const q = query(collection(db, "boats"));
      unsubscribe = onSnapshot(q, (snapshot) => {
        const firebaseBoats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Boat));
        if (snapshot.empty && supabase) {
          supabase.from('boats').select('*').then(({ data }) => {
            if (data && data.length > 0) {
              setBoats(data.map(b => ({
                id: b.id.toString(),
                name: b.name,
                type: b.type as any,
                brand: b.brand,
                model: b.model,
                colour: b.colour,
                paddlerWeight: b.paddler_weight,
                notes: b.notes,
                status: b.status as any,
                description: b.description,
                imageUrl: b.image_url,
                location: b.location,
                costPerDay: Number(b.cost_per_day) || 0,
                costPerWeekend: Number(b.cost_per_weekend) || 0,
                costPerDayOver: Number(b.cost_per_day_long) || 0,
                length: b.length,
                addedAt: { toDate: () => new Date(b.created_at) }
              } as Boat)));
            }
          });
        } else {
          setBoats(firebaseBoats);
        }
        setLoading(false);
      }, (error) => {
        console.warn("Firestore boats sync failed.");
        if (supabase) {
          supabase.from('boats').select('*').then(({ data }) => {
            if (data) {
              setBoats(data.map(b => ({
                id: b.id.toString(),
                name: b.name,
                type: b.type as any,
                brand: b.brand,
                model: b.model,
                colour: b.colour,
                paddlerWeight: b.paddler_weight,
                notes: b.notes,
                status: b.status as any,
                description: b.description,
                imageUrl: b.image_url,
                location: b.location,
                costPerDay: Number(b.cost_per_day) || 0,
                costPerWeekend: Number(b.cost_per_weekend) || 0,
                costPerDayOver: Number(b.cost_per_day_long) || 0,
                length: b.length,
                addedAt: { toDate: () => new Date(b.created_at) }
              } as Boat)));
            }
            setLoading(false);
          });
        }
      });
    } else if (supabase) {
      // Direct Supabase fetch if db is null
      supabase.from('boats').select('*').then(({ data }) => {
        if (data) {
          setBoats(data.map(b => ({
             id: b.id.toString(),
             name: b.name,
             type: b.type as any,
             brand: b.brand,
             model: b.model,
             colour: b.colour,
             paddlerWeight: b.paddler_weight,
             notes: b.notes,
             status: b.status as any,
             description: b.description,
             imageUrl: b.image_url,
             location: b.location,
             costPerDay: Number(b.cost_per_day) || 0,
             costPerWeekend: Number(b.cost_per_weekend) || 0,
             costPerDayOver: Number(b.cost_per_day_long) || 0,
             length: b.length,
             addedAt: { toDate: () => new Date(b.created_at) }
          } as Boat)));
        }
        setLoading(false);
      });
    } else {
      setLoading(false);
    }

    return () => unsubscribe();
  }, [authLoading]);

  const canManage = profile?.role === "admin" || profile?.role === "leader" || profile?.role === "instructor";

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
      </div>
    );
  }

  if (loading && boats.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const brand = formData.get("brand") as string;
    const model = formData.get("model") as string;
    const name = `${brand} ${model}`.trim() || "Unnamed Equipment";

    const data = {
      name,
      type: formData.get("type") as Boat["type"],
      brand,
      model,
      colour: formData.get("colour") as string,
      paddlerWeight: formData.get("paddlerWeight") as string,
      notes: formData.get("notes") as string,
      description: formData.get("description") as string,
      status: formData.get("status") as Boat["status"],
      location: formData.get("location") as string,
      length: formData.get("length") as string,
      imageUrl: formData.get("imageUrl") as string || `https://picsum.photos/seed/${name}/400/300`,
      costPerDay: Number(formData.get("costPerDay")) || 0,
      costPerWeekend: Number(formData.get("costPerWeekend")) || 0,
      costPerDayOver: Number(formData.get("costPerDayOver")) || 0,
    };

    try {
      if (editingBoat) {
        if (db) await setDoc(doc(db, "boats", editingBoat.id), data, { merge: true });
        await syncBoatToSupabase(editingBoat.id, data);
        setEditingBoat(null);
      } else {
        let newId = "";
        if (db) {
           const docRef = await addDoc(collection(db, "boats"), {
             ...data,
             addedAt: serverTimestamp()
           });
           newId = docRef.id;
        }
        if (newId) {
          await syncBoatToSupabase(newId, data);
        }
        setShowAdd(false);
      }
    } catch (error) {
      handleFirestoreError(error, editingBoat ? OperationType.UPDATE : OperationType.CREATE, "boats");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this item?")) return;
    try {
      if (db) await setDoc(doc(db, "boats", id), { status: "retired" }, { merge: true });
      if (supabase) {
        const { error: supErr } = await supabase.from('boats').update({ status: 'retired' }).eq('firebase_id', id);
        if (supErr) {
           // Fallback if firebase_id doesn't match yet
           await supabase.from('boats').update({ status: 'retired' }).eq('id', id);
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `boats/${id}`);
    }
  };

  const handleImportJSON = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        const items = Array.isArray(json) ? json : [json];
        for (const item of items) {
          const boatData = {
            name: item.name || "Unnamed Boat",
            type: item.type || "General Purpose",
            brand: item.brand || "",
            model: item.model || "",
            colour: item.colour || item.Colour || "",
            paddlerWeight: item.paddlerWeight || item["Paddler weight"] || "",
            notes: item.notes || item.Notes || "",
            description: item.description || "",
            status: item.status || "available",
            location: item.location || item.Location || "",
            imageUrl: item.imageUrl || item.Photo || `https://picsum.photos/seed/${item.name}/400/300`,
          };
          
          if (db) {
            const docRef = await addDoc(collection(db, "boats"), {
              ...boatData,
              addedAt: serverTimestamp()
            });
            await syncBoatToSupabase(docRef.id, boatData);
          }
        }
        alert(`Successfully imported ${items.length} items.`);
      } catch (error) {
        console.error("Import error:", error);
        alert("Failed to import JSON. Please check the format.");
      }
    };
    reader.readAsText(file);
  };

  const seedSampleData = async () => {
    const samples = [
      { name: "Valley Etain", type: "Sea Kayak", brand: "Valley", model: "17.5", colour: "Red/White", paddlerWeight: "75-100kg", status: "available", location: "Red Container", description: "A high-performance sea kayak for long expeditions.", costPerDay: 25, costPerWeekend: 45, costPerDayOver: 20 },
      { name: "P&H Scorpio", type: "Sea Kayak", brand: "P&H", model: "MV", colour: "Blue", paddlerWeight: "65-95kg", status: "available", location: "Red Container", description: "Versatile plastic sea kayak for all conditions.", costPerDay: 20, costPerWeekend: 35, costPerDayOver: 15 },
      { name: "Pyranha Burn", type: "Whitewater", brand: "Pyranha", model: "III", colour: "Orange", paddlerWeight: "70-90kg", status: "available", location: "Green Container", description: "Classic river runner for whitewater adventures.", costPerDay: 15, costPerWeekend: 25, costPerDayOver: 12 },
      { name: "Dagger Mamba", type: "Whitewater", brand: "Dagger", model: "8.6", colour: "Lime", paddlerWeight: "75-100kg", status: "available", location: "Green Container", description: "Stable and predictable creek boat.", costPerDay: 15, costPerWeekend: 25, costPerDayOver: 12 },
      { name: "Kirton Talisman", type: "Racing", brand: "Kirton", model: "Talisman", colour: "White", paddlerWeight: "70-85kg", status: "available", location: "Red Container", description: "Stable marathon racing kayak.", costPerDay: 30, costPerWeekend: 55, costPerDayOver: 25 },
      { name: "Epic V8", type: "Surfski", brand: "Epic", model: "V8", colour: "White/Black", paddlerWeight: "60-110kg", status: "available", location: "Pool", description: "Entry-level surfski with great stability.", costPerDay: 35, costPerWeekend: 60, costPerDayOver: 30 },
    ];
    try {
      for (const item of samples) {
        const boatData = {
          ...item,
          imageUrl: `https://picsum.photos/seed/${item.name}/400/300`,
        };
        if (db) {
          const docRef = await addDoc(collection(db, "boats"), {
            ...boatData,
            addedAt: serverTimestamp()
          });
          await syncBoatToSupabase(docRef.id, boatData);
        }
      }
      alert("Sample data seeded successfully.");
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, "boats");
    }
  };

  const categories: Boat["type"][] = ["Sea Kayak", "Whitewater", "General Purpose", "Racing", "Surfski", "Canoe", "Other"];

  const categoryIcons = {
    "Sea Kayak": Waves,
    "Whitewater": Zap,
    "General Purpose": Anchor,
    "Racing": Trophy,
    "Surfski": Wind,
    "Canoe": Anchor,
    "Other": Compass
  };

  const calculateRentalPrice = (boat: Boat, start: string, end: string, includeExtras?: boolean) => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    let days = differenceInDays(endDate, startDate);
    
    // Ensure at least 1 day is counted if start and end are the same or overlapping
    if (days <= 0) days = 1;

    const costPerDay = boat.costPerDay || 0;
    const costPerWeekend = boat.costPerWeekend || 0;
    const costPerDayOver = boat.costPerDayOver || 0;

    // Check if it's a weekend (Sat-Sun)
    const interval = eachDayOfInterval({ start: startDate, end: addDays(endDate, -1) });
    const weekendDays = interval.filter(d => isWeekend(d)).length;
    
    let basePrice = 0;
    if (days === 2 && weekendDays === 2 && costPerWeekend > 0) {
      basePrice = costPerWeekend;
    } else if (days > 3 && costPerDayOver > 0) {
      basePrice = days * costPerDayOver;
    } else {
      basePrice = days * costPerDay;
    }

    // Add extras: £1 per day for all items together
    let extrasPrice = 0;
    if (includeExtras) {
      extrasPrice = 1 * days;
    }

    return basePrice + extrasPrice;
  };

  const handleRent = async (boat: Boat) => {
    if (!user) {
      signIn();
      return;
    }
    setIncludeRentalExtras(false);
    setSelectedBoatForRental(boat);
    setIsRentModalOpen(true);
  };

  const handleProcessRental = async () => {
    if (!selectedBoatForRental) return;
    
    const amountVal = calculateRentalPrice(selectedBoatForRental, rentalDates.start, rentalDates.end, includeRentalExtras);
    if (amountVal <= 0) {
      alert("Invalid rental duration or price. Please select different dates.");
      return;
    }
    
    setIsProcessingPayment(true);
    const amount = amountVal * 100; // in pence

    try {
      const response = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "boat_rental",
          userId: user?.uid,
          userEmail: user?.email,
          boatName: selectedBoatForRental.name,
          boatId: selectedBoatForRental.id,
          dates: `${rentalDates.start} to ${rentalDates.end}`,
          extras: includeRentalExtras ? "Paddle, Spray Deck, BA" : "None",
          amount: Math.round(amount)
        }),
      });

      const data = await safeJson(response);
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to create checkout session");
      }

      if (data.url) {
        openPaymentUrl(data.url);
        setIsRentModalOpen(false); // Close modal 
        setIsProcessingPayment(false); 
      } else if (data.id) {
        const publishableKey = data.publishableKey || (import.meta as any).env.VITE_STRIPE_PUBLISHABLE_KEY || (import.meta as any).env.STRIPE_Publishable_key;
        if (!publishableKey || publishableKey === "pk_test_...") {
          alert("Stripe Publishable Key is not set. Please configure VITE_STRIPE_PUBLISHABLE_KEY in AI Studio Secrets.");
          setIsProcessingPayment(false);
          return;
        }
        const stripe = await (window as any).Stripe(publishableKey);
        await stripe.redirectToCheckout({ sessionId: data.id });
      }
    } catch (error) {
      console.error("Payment error:", error);
      alert("Failed to initiate payment. Please try again.");
    } finally {
      setIsProcessingPayment(false);
    }
  };

  return (
    <div className="space-y-8 py-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div className="space-y-2">
          <h2 className="text-3xl font-bold">Boats & Equipment</h2>
          <p className="text-slate-600">Our club fleet and equipment showcase.</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            {boats.length === 0 && (
              <Button variant="ghost" size="sm" onClick={seedSampleData} className="text-slate-400 hover:text-emerald-600">
                Seed Samples
              </Button>
            )}
            <label className="cursor-pointer inline-flex items-center justify-center rounded-lg font-medium transition-colors px-4 py-2 border border-slate-200 hover:bg-slate-50">
              <span>Import JSON</span>
              <input type="file" accept=".json" className="hidden" onChange={handleImportJSON} />
            </label>
            <Button onClick={() => setShowAdd(!showAdd)}>
              {showAdd ? "Cancel" : "Add Equipment"}
            </Button>
          </div>
        )}
      </div>

      {/* Category Selector */}
      <div className="flex flex-wrap gap-4">
        <button
          onClick={() => setSelectedCategory("All")}
          className={cn(
            "flex items-center gap-2 px-6 py-3 rounded-2xl border transition-all",
            selectedCategory === "All" 
              ? "bg-emerald-600 text-white border-emerald-600 shadow-lg shadow-emerald-200" 
              : "bg-white text-slate-600 border-slate-200 hover:border-emerald-200"
          )}
        >
          <Anchor size={20} />
          <span className="font-semibold">All Fleet</span>
        </button>
        {categories.map(cat => {
          const Icon = categoryIcons[cat];
          return (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={cn(
                "flex items-center gap-2 px-6 py-3 rounded-2xl border transition-all",
                selectedCategory === cat 
                  ? "bg-emerald-600 text-white border-emerald-600 shadow-lg shadow-emerald-200" 
                  : "bg-white text-slate-600 border-slate-200 hover:border-emerald-200"
              )}
            >
              <Icon size={20} />
              <span className="font-semibold">{cat}s</span>
            </button>
          );
        })}
      </div>

      {(showAdd || editingBoat) && (
        <Card className="p-6 max-w-3xl mx-auto">
          <h3 className="text-xl font-bold mb-4">{editingBoat ? "Edit Equipment" : "Add New Equipment"}</h3>
          <form onSubmit={handleSubmit} className="grid md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Brand *</label>
              <input name="brand" required className="w-full p-2 border rounded-lg" defaultValue={editingBoat?.brand} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Model *</label>
              <input name="model" required className="w-full p-2 border rounded-lg" defaultValue={editingBoat?.model} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Category *</label>
              <select name="type" required className="w-full p-2 border rounded-lg" defaultValue={editingBoat?.type}>
                {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <select name="status" className="w-full p-2 border rounded-lg" defaultValue={editingBoat?.status || "available"}>
                <option value="available">Available</option>
                <option value="maintenance">Maintenance</option>
                <option value="rented">Rented</option>
                <option value="retired">Retired</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Location</label>
              <select name="location" className="w-full p-2 border rounded-lg" defaultValue={editingBoat?.location || "Red Container"}>
                <option value="Red Container">Red Container</option>
                <option value="Green Container">Green Container</option>
                <option value="Pool">Pool</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Colour</label>
              <input name="colour" className="w-full p-2 border rounded-lg" defaultValue={editingBoat?.colour} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Length</label>
              <input name="length" className="w-full p-2 border rounded-lg" placeholder="e.g. 5.2m" defaultValue={editingBoat?.length} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Paddler Weight</label>
              <input name="paddlerWeight" className="w-full p-2 border rounded-lg" defaultValue={editingBoat?.paddlerWeight} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Image URL</label>
              <input name="imageUrl" className="w-full p-2 border rounded-lg" placeholder="https://..." defaultValue={editingBoat?.imageUrl} />
            </div>
            <div className="space-y-2 md:col-span-3">
              <label className="text-sm font-medium">Notes</label>
              <input name="notes" className="w-full p-2 border rounded-lg" defaultValue={editingBoat?.notes} />
            </div>
            <div className="space-y-2 md:col-span-3">
              <label className="text-sm font-medium">Description</label>
              <textarea name="description" className="w-full p-2 border rounded-lg" defaultValue={editingBoat?.description} />
            </div>
            
            <div className="md:col-span-3 grid grid-cols-3 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
              <div className="space-y-2">
                <label className="text-sm font-medium">Cost per Day (£)</label>
                <input type="number" name="costPerDay" className="w-full p-2 border rounded-lg" defaultValue={editingBoat?.costPerDay} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Cost Weekend (£)</label>
                <input type="number" name="costPerWeekend" className="w-full p-2 border rounded-lg" defaultValue={editingBoat?.costPerWeekend} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Cost Day Over (£)</label>
                <input type="number" name="costPerDayOver" className="w-full p-2 border rounded-lg" defaultValue={editingBoat?.costPerDayOver} />
              </div>
            </div>

            <Button type="submit" className="md:col-span-3">
              {editingBoat ? "Update Equipment" : "Save Equipment"}
            </Button>
          </form>
        </Card>
      )}

      <div className="space-y-12">
        {categories.filter(cat => selectedCategory === "All" || selectedCategory === cat).map(category => {
          const categoryBoats = boats.filter(b => b.type === category && b.status !== "retired");
          if (categoryBoats.length === 0) return null;

          return (
            <div key={category} className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="p-2 bg-emerald-100 text-emerald-700 rounded-lg">
                  {React.createElement(categoryIcons[category], { size: 24 })}
                </div>
                <h3 className="text-2xl font-bold text-slate-800">{category}s</h3>
                <div className="h-px flex-1 bg-slate-200" />
                <Badge variant="default">{categoryBoats.length} items</Badge>
              </div>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {categoryBoats.map(boat => (
                  <Card key={boat.id} className="overflow-hidden flex flex-col group border-slate-200 hover:border-emerald-200 transition-all hover:shadow-xl">
                    <div className="aspect-[3/2] relative overflow-hidden">
                      <img 
                        src={boat.imageUrl || `https://picsum.photos/seed/${boat.name}/600/400`} 
                        alt={boat.name} 
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute top-2 right-2 flex gap-2">
                        <Badge variant={boat.status === "available" ? "success" : boat.status === "maintenance" ? "warning" : "info"}>
                          {boat.status}
                        </Badge>
                      </div>
                    </div>
                    <div className="p-6 flex-1 space-y-4">
                      <div className="space-y-1">
                        <h3 className="text-xl font-bold">{boat.name}</h3>
                      </div>
                      
                      <div className="space-y-3 text-sm">
                        <div className="space-y-1">
                          <div className="text-slate-400">Suitable for paddlers who weigh:</div>
                          <div className="text-slate-700 font-medium">{boat.paddlerWeight || "N/A"}</div>
                        </div>
                        {boat.length && (
                          <div className="space-y-1">
                            <div className="text-slate-400">Boat Length:</div>
                            <div className="text-slate-700 font-medium">{boat.length}</div>
                          </div>
                        )}
                        {boat.colour && (
                          <div className="space-y-1">
                            <div className="text-slate-400">Colour:</div>
                            <div className="text-slate-700 font-medium">{boat.colour}</div>
                          </div>
                        )}
                      </div>

                      {boat.notes && (
                        <div className="p-3 bg-slate-50 rounded-lg text-xs text-slate-600 border border-slate-100 italic">
                          "{boat.notes}"
                        </div>
                      )}

                      <div className="space-y-2">
                        <p className="text-slate-600 text-sm line-clamp-2">{boat.description}</p>
                        {boat.location && (
                          <div className="flex items-center gap-1.5 text-xs text-slate-400">
                            <MapPin size={12} />
                            <span>Location: {boat.location}</span>
                          </div>
                        )}
                      </div>
                      
                      {user && (
                        <div className="pt-2 border-t border-slate-100 space-y-3">
                          <div className="flex items-center gap-2 text-[10px] text-slate-400 uppercase tracking-wider font-bold">
                            <Info size={12} />
                            Free for club sessions
                          </div>
                          
                          <div className="flex items-center justify-between">
                            {boat.costPerDay ? (
                              <div className="text-sm font-semibold text-slate-600">
                                £{boat.costPerDay}<span className="text-slate-400 font-normal">/day rental</span>
                              </div>
                            ) : <div />}
                            
                            <div className="flex flex-col items-end gap-1">
                              {profile ? (
                                <>
                                  <Button 
                                    variant="primary"
                                    size="lg"
                                    className="w-full sm:w-auto font-black h-14 px-8 text-lg rounded-2xl shadow-xl shadow-emerald-100 hover:scale-105 transition-all"
                                    disabled={boat.status !== "available" || !(profile?.onboardingStatus === "membership_paid" || canManage)}
                                    onClick={() => handleRent(boat)}
                                  >
                                    <Anchor size={20} className="mr-2" />
                                    {boat.status === "available" 
                                      ? "Rent for trip" 
                                      : boat.status === "maintenance" 
                                        ? "MAINTENANCE" 
                                        : "RENTED"}
                                  </Button>
                                  {(profile?.onboardingStatus !== "membership_paid" && !canManage) && boat.status === "available" && (
                                    <div className="flex flex-col items-center">
                                      <span className="text-[10px] text-amber-600 font-bold bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">Members only</span>
                                      <Link to="/onboarding" className="text-[9px] text-emerald-600 hover:underline mt-1 font-bold italic underline">Become a Member</Link>
                                    </div>
                                  )}
                                </>
                              ) : (
                                <div className="text-[10px] text-slate-400 italic">Sign in to rent</div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    {canManage && (
                      <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-2">
                        <Button variant="outline" size="sm" className="flex-1" onClick={() => setEditingBoat(boat)}>
                          <Edit size={16} className="mr-2" /> Edit
                        </Button>
                        <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => handleDelete(boat.id)}>
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Rental Modal */}
      {isRentModalOpen && selectedBoatForRental && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl space-y-6"
          >
            <div className="flex justify-between items-start">
              <div className="space-y-1">
                <h3 className="text-2xl font-bold">Rent {selectedBoatForRental.name}</h3>
                <p className="text-slate-500">Select your rental period</p>
              </div>
              <button onClick={() => setIsRentModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                <X size={24} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-600">Start Date</label>
                  <input 
                    type="date" 
                    min={format(new Date(), "yyyy-MM-dd")}
                    value={rentalDates.start}
                    onChange={(e) => setRentalDates({ ...rentalDates, start: e.target.value })}
                    className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-600">End Date</label>
                  <input 
                    type="date" 
                    min={rentalDates.start}
                    value={rentalDates.end}
                    onChange={(e) => setRentalDates({ ...rentalDates, end: e.target.value })}
                    className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <label className="flex items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100 cursor-pointer hover:bg-emerald-50 hover:border-emerald-100 transition-all group">
                  <input 
                    type="checkbox" 
                    checked={includeRentalExtras}
                    onChange={(e) => setIncludeRentalExtras(e.target.checked)}
                    className="w-5 h-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-bold text-slate-700 group-hover:text-emerald-700">Add Extras Bundle (+£1/day)</div>
                    <div className="text-xs text-slate-500">Includes Paddle, Spray Deck, and BA</div>
                  </div>
                </label>
              </div>

              <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-emerald-700">Rental Duration:</span>
                  <span className="font-bold text-emerald-900">
                    {differenceInDays(new Date(rentalDates.end), new Date(rentalDates.start))} days
                  </span>
                </div>
                <div className="flex justify-between text-lg font-bold">
                  <span className="text-emerald-900">Total Price:</span>
                  <span className="text-emerald-600">
                    £{calculateRentalPrice(selectedBoatForRental, rentalDates.start, rentalDates.end, includeRentalExtras)}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-3 p-4 bg-amber-50 rounded-2xl border border-amber-100 text-xs text-amber-800">
                <Info size={16} className="shrink-0 mt-0.5" />
                <p>
                  Pricing: £{selectedBoatForRental.costPerDay}/day. 
                  {selectedBoatForRental.costPerWeekend && ` Weekend special: £${selectedBoatForRental.costPerWeekend}.`}
                  {selectedBoatForRental.costPerDayOver && ` Long term (>3 days): £${selectedBoatForRental.costPerDayOver}/day.`}
                </p>
              </div>
            </div>

            <Button 
              className="w-full py-6 text-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-200"
              onClick={handleProcessRental}
              disabled={isProcessingPayment || differenceInDays(new Date(rentalDates.end), new Date(rentalDates.start)) <= 0}
            >
              {isProcessingPayment ? "Redirecting to Stripe..." : "Confirm & Pay"}
            </Button>
          </motion.div>
        </div>
      )}
    </div>
  );
};

const MemberDirectory = () => {
  const { profile } = useAuth();
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "users"));
    const unsubscribe = onSnapshot(q, (snap) => {
      const data = snap.docs.map(doc => doc.data() as UserProfile);
      setMembers(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "users");
    });
    return () => unsubscribe();
  }, []);

  const canManage = profile?.role === "admin" || profile?.role === "leader" || profile?.role === "instructor";

  if (!canManage) return <Home />;

  return (
    <div className="space-y-8 py-8">
      <div className="space-y-2">
        <h2 className="text-3xl font-bold">Member Directory</h2>
        <p className="text-slate-600">Manage club members and new joiners.</p>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="p-4 font-bold text-sm">Name</th>
              <th className="p-4 font-bold text-sm">Email</th>
              <th className="p-4 font-bold text-sm">Level</th>
              <th className="p-4 font-bold text-sm">Role</th>
              <th className="p-4 font-bold text-sm">Status</th>
              <th className="p-4 font-bold text-sm">Path</th>
              <th className="p-4 font-bold text-sm">Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map(m => (
              <tr key={m.uid} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                <td className="p-4">
                  <div className="font-medium text-slate-900">{m.firstName} {m.lastName}</div>
                  <div className="text-[10px] text-slate-500 font-mono italic">{m.displayName || "No display name"}</div>
                </td>
                <td className="p-4 text-sm text-slate-600">{m.email}</td>
                <td className="p-4">
                  <Badge variant={m.paddlingLevel === 1 ? "destructive" : m.paddlingLevel === 3 ? "info" : "secondary"}>
                    {m.paddlingLevel ? `LVL ${m.paddlingLevel}` : "None"}
                  </Badge>
                </td>
                <td className="p-4">
                  <Badge variant={m.role === "admin" ? "warning" : m.role === "member" ? "success" : "default"}>
                    {m.role}
                  </Badge>
                </td>
                <td className="p-4">
                  <Badge variant="info" className="text-[10px] uppercase tracking-wider">
                    {m.onboardingStatus.replace(/_/g, " ")}
                  </Badge>
                </td>
                <td className="p-4 text-sm capitalize">{m.onboardingPath || "-"}</td>
                <td className="p-4">
                  <Link to={`/profile?uid=${m.uid}`}>
                    <Button variant="ghost" size="sm">View</Button>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
};

const ConductConsentModal = () => {
  const { user, profile } = useAuth();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (profile && !profile.hasAcceptedConduct) {
      setShow(true);
    } else {
      setShow(false);
    }
  }, [profile]);

  const handleAccept = async () => {
    if (!user) return;
    try {
      if (db) await updateDoc(doc(db, "users", user.uid), {
        hasAcceptedConduct: true,
        conductAcceptedAt: serverTimestamp()
      });
      syncProfileToSupabase(user.uid, { hasAcceptedConduct: true });
      setShow(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <Card className="max-w-2xl w-full p-8 space-y-6 shadow-2xl border-emerald-500/20">
        <div className="flex items-center gap-3 text-emerald-600">
          <ShieldCheck size={32} />
          <h2 className="text-3xl font-bold text-slate-900">Code of Conduct</h2>
        </div>
        
        <div className="prose prose-slate max-h-[50vh] overflow-y-auto pr-4 text-slate-600 space-y-4">
          <h3 className="text-xl font-bold">I give consent...</h3>
          <p className="text-sm">I give consent for Putney Bridge CC to use my personal data for the following purposes:</p>
          <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 space-y-4 text-sm">
            <p>• To process my membership and participation in club events.</p>
            <p>• To contact me regarding club activities, safety information, and social events.</p>
            <p>• To share necessary health/emergency information with event leaders for safety purposes.</p>
          </div>
          <p className="font-bold">By clicking "I Agree", you also confirm you have read and will abide by the Code of Conduct:</p>
          <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 space-y-4 text-sm opacity-80 scale-95">
            <h4 className="font-bold text-slate-900">1. Safety First</h4>
            <p>Always follow the instructions of leaders and instructors. Wear appropriate safety equipment at all times on the water.</p>
            
            <h4 className="font-bold text-slate-900">2. Respect Others</h4>
            <p>Treat all members, volunteers, and members of the public with respect and courtesy. Harassment or abusive behavior will not be tolerated.</p>
            
            <h4 className="font-bold text-slate-900 text-[10px] uppercase">...and 2 other clauses (refer to About Us page)</h4>
          </div>
          <p className="text-xs italic">You can modify this consent text in App.tsx under ConductConsentModal.</p>
        </div>

        <div className="flex flex-col gap-3">
          <Button onClick={handleAccept} className="w-full py-4 text-lg">I Agree to the Code of Conduct</Button>
          <p className="text-center text-xs text-slate-400">Consent is required to use club facilities and join events.</p>
        </div>
      </Card>
    </div>
  );
};

const CookieConsent = () => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem("cookie-consent");
    if (!consent) {
      setShow(true);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem("cookie-consent", "true");
    setShow(false);
  };

  const handleReject = () => {
    localStorage.setItem("cookie-consent", "false");
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-white border border-slate-200 shadow-2xl rounded-2xl p-6 z-[100] space-y-4">
      <div className="flex items-start gap-3">
        <Info className="text-emerald-600 shrink-0" size={24} />
        <div className="space-y-1">
          <h4 className="font-bold text-slate-900">Cookie Policy</h4>
          <p className="text-xs text-slate-500 leading-relaxed">
            We use cookies to enhance your experience and analyze our traffic. You have the right to decide whether to accept or reject cookies. You can exercise your cookie rights by setting your preferences below.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={handleAccept}>Accept All</Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={handleReject}>Reject Non-Essential</Button>
        </div>
        <Link to="/cookie-policy" className="w-full">
          <Button size="sm" variant="ghost" className="w-full text-xs text-slate-400">Read Full Policy</Button>
        </Link>
      </div>
    </div>
  );
};

const ContactPage = () => {
  const [activeTab, setActiveTab] = useState<"info" | "membership" | "pool">("info");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const recipients = {
    info: { label: "General Info", email: "info@putneybridgecc.co.uk", role: "Default" },
    membership: { label: "Membership", email: "membership@putneybridgecc.co.uk", role: "Finance" },
    pool: { label: "Pool Sessions", email: "pool@putneybridgecc.co.uk", role: "Instructor" }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1500));
    setIsSubmitting(false);
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="max-w-md mx-auto py-20 text-center space-y-6">
        <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle2 size={40} />
        </div>
        <h2 className="text-3xl font-bold text-slate-900">Message Sent!</h2>
        <p className="text-slate-600">Thank you for reaching out. We'll get back to you at {recipients[activeTab].email} as soon as possible.</p>
        <Button onClick={() => setSubmitted(false)}>Send Another Message</Button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-12 space-y-12">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold text-slate-900">Contact Us</h1>
        <p className="text-slate-600 max-w-2xl mx-auto">
          Have a question? Select the appropriate department below and send us a message.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-8">
        <div className="md:col-span-1 space-y-4">
          <div className="flex flex-col gap-2">
            {(Object.keys(recipients) as Array<keyof typeof recipients>).map((key) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={cn(
                  "flex flex-col items-start p-4 rounded-2xl border transition-all text-left",
                  activeTab === key 
                    ? "bg-emerald-50 border-emerald-200 ring-2 ring-emerald-500/20" 
                    : "bg-white border-slate-200 hover:border-slate-300"
                )}
              >
                <span className={cn("font-bold text-sm", activeTab === key ? "text-emerald-700" : "text-slate-700")}>
                  {recipients[key].label}
                </span>
                <span className="text-xs text-slate-500">{recipients[key].email}</span>
              </button>
            ))}
          </div>

          <Card className="p-6 bg-slate-900 text-white space-y-4">
            <h4 className="font-bold flex items-center gap-2"><MapPin size={18} className="text-emerald-400" /> Location</h4>
            <p className="text-sm text-slate-400 leading-relaxed">
              Putney Bridge Canoe Club<br />
              Embankment, Putney<br />
              London, SW15 1LB
            </p>
          </Card>
        </div>

        <Card className="md:col-span-2 p-8 shadow-xl border-slate-100">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">First Name</label>
                <input required className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="Jane" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Last Name</label>
                <input required className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="Doe" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Email Address</label>
              <input type="email" required className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="jane@example.com" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Phone Number</label>
                <input type="tel" className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="07700 900000" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Years of Experience</label>
                <input type="number" className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="0" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Message for {recipients[activeTab].label}</label>
              <textarea required className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none min-h-[150px]" placeholder="How can we help you? Tell us about your paddling background if relevant." />
            </div>
            <Button type="submit" className="w-full py-4 text-lg" disabled={isSubmitting}>
              {isSubmitting ? "Sending..." : `Send to ${recipients[activeTab].label}`}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
};

const CookiePolicy = () => (
  <div className="max-w-3xl mx-auto py-12 space-y-8">
    <h1 className="text-4xl font-bold">Cookie Policy</h1>
    <div className="prose prose-slate max-w-none space-y-6 text-slate-600">
      <p>This Cookie Policy explains how Putney Bridge Canoe Club ("we", "us", and "our") uses cookies and similar technologies to recognize you when you visit our website.</p>
      
      <h2 className="text-2xl font-bold text-slate-900">What are cookies?</h2>
      <p>Cookies are small data files that are placed on your computer or mobile device when you visit a website. Cookies are widely used by website owners in order to make their websites work, or to work more efficiently, as well as to provide reporting information.</p>

      <h2 className="text-2xl font-bold text-slate-900">Why do we use cookies?</h2>
      <p>We use first-party and third-party cookies for several reasons. Some cookies are required for technical reasons in order for our Website to operate, and we refer to these as "essential" or "strictly necessary" cookies.</p>
      
      <ul className="list-disc pl-6 space-y-2">
        <li><strong>Essential cookies:</strong> These cookies are strictly necessary to provide you with services available through our Website and to use some of its features, such as access to secure areas.</li>
        <li><strong>Analytics cookies:</strong> These cookies collect information that is used either in aggregate form to help us understand how our Website is being used or how effective our marketing campaigns are.</li>
      </ul>

      <h2 className="text-2xl font-bold text-slate-900">How can I control cookies?</h2>
      <p>You have the right to decide whether to accept or reject cookies. You can exercise your cookie rights by setting your preferences in the Cookie Consent banner.</p>
    </div>
  </div>
);

const Home = () => (
  <div className="space-y-12 pb-12">
    <section className="relative h-[600px] flex items-center justify-center overflow-hidden -mx-4 sm:-mx-6 lg:-mx-8">
      <div className="absolute inset-0 z-0">
        <img 
          src="https://lh3.googleusercontent.com/d/10gD_eGOENkhLkfq5V4b3Skq_Y1EcRXKY=s2000" 
          alt="Kayaking Hero" 
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-[2px]" />
      </div>
      
      <div className="relative z-10 text-center space-y-8 max-w-4xl px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="space-y-4"
        >
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white leading-tight">
            <EditableContent 
              pageId="home" 
              sectionId="hero_title" 
              defaultContent="Paddle with the Best. Explore the Wild." 
            />
          </h1>
          <div className="text-xl md:text-2xl text-slate-200 leading-relaxed max-w-2xl mx-auto">
            <EditableContent 
              pageId="home" 
              sectionId="hero_desc" 
              defaultContent="Join Putney Bridge Canoe Club for unforgettable river tours, professional training, and a vibrant community of water enthusiasts." 
            />
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.8 }}
          className="flex flex-col sm:flex-row justify-center gap-4"
        >
          <Link to="/onboarding">
            <Button size="lg" className="h-14 px-8 text-xl bg-emerald-500 hover:bg-emerald-600 border-none">Join the Club</Button>
          </Link>
          <Link to="/events">
            <Button variant="outline" size="lg" className="h-14 px-8 text-xl bg-white/10 text-white border-white/30 hover:bg-white/20 backdrop-blur-sm">View Events</Button>
          </Link>
        </motion.div>
      </div>
    </section>

    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="grid md:grid-cols-3 gap-8">
        <Card className="p-8 space-y-4 hover:shadow-lg transition-shadow border-slate-100">
          <div className="w-14 h-14 bg-emerald-100 rounded-2xl flex items-center justify-center text-emerald-600">
            <Waves size={32} />
          </div>
          <h3 className="text-2xl font-bold">
            <EditableContent pageId="home" sectionId="feature1_title" defaultContent="River Tours" />
          </h3>
          <div className="text-slate-600 leading-relaxed">
            <EditableContent pageId="home" sectionId="feature1_desc" defaultContent="From calm lakes to challenging rapids, we have tours for every skill level." />
          </div>
        </Card>
        <Card className="p-8 space-y-4 hover:shadow-lg transition-shadow border-slate-100">
          <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600">
            <Users size={32} />
          </div>
          <h3 className="text-2xl font-bold">
            <EditableContent pageId="home" sectionId="feature2_title" defaultContent="Community" />
          </h3>
          <div className="text-slate-600 leading-relaxed">
            <EditableContent pageId="home" sectionId="feature2_desc" defaultContent="Meet like-minded paddlers and share your passion for the water." />
          </div>
        </Card>
        <Card className="p-8 space-y-4 hover:shadow-lg transition-shadow border-slate-100">
          <div className="w-14 h-14 bg-amber-100 rounded-2xl flex items-center justify-center text-amber-600">
            <Shield size={32} />
          </div>
          <h3 className="text-2xl font-bold">
            <EditableContent pageId="home" sectionId="feature3_title" defaultContent="Safety First" />
          </h3>
          <div className="text-slate-600 leading-relaxed">
            <EditableContent pageId="home" sectionId="feature3_desc" defaultContent="Professional leaders and pool sessions to ensure everyone is ready for the river." />
          </div>
        </Card>
      </div>
    </div>
  </div>
);

const CLUB_DRIVE_PHOTOS_URL = "https://drive.google.com/drive/folders/1zPuMWqGE7DIy-EfjcCU-DRmFAjGvxTzK";

const PoolSessionPicker = ({ onSelect, selectedId }: { onSelect: (id: string) => void, selectedId?: string }) => {
  const [sessions, setSessions] = useState<ClubEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "events"), where("type", "==", "pool"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ClubEvent));
      // Filter for Wednesdays and capacity
      const wednesdays = docs.filter(s => {
        const date = s.date?.toDate ? s.date.toDate() : new Date(s.date);
        return date.getDay() === 3; // 3 is Wednesday
      });
      setSessions(wednesdays);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "events");
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  if (loading) return <div className="animate-pulse h-32 bg-slate-100 rounded-xl" />;
  if (sessions.length === 0) return <div className="p-4 bg-amber-50 text-amber-700 rounded-lg text-sm">No pool sessions currently available for booking.</div>;

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium text-slate-700">Select a Wednesday Pool Session</label>
      <div className="grid gap-3">
        {sessions.map(s => {
          const date = s.date?.toDate ? s.date.toDate() : new Date(s.date);
          const isFull = s.participants.length >= s.maxParticipants;
          const isSelected = selectedId === s.id;

          return (
            <div 
              key={s.id}
              onClick={() => !isFull && onSelect(s.id)}
              className={cn(
                "p-4 rounded-xl border-2 transition-all cursor-pointer flex justify-between items-center",
                isSelected ? "border-emerald-500 bg-emerald-50" : "border-slate-100 hover:border-slate-200",
                isFull && "opacity-50 cursor-not-allowed bg-slate-50"
              )}
            >
              <div className="space-y-1">
                <div className="font-bold">{format(date, "EEEE, MMMM do")}</div>
                <div className="text-xs text-slate-500">7:30 PM - 9:00 PM · {s.maxParticipants - s.participants.length} spaces left</div>
              </div>
              {isFull ? (
                <Badge variant="default">Full</Badge>
              ) : isSelected ? (
                <CheckCircle2 className="text-emerald-500" size={20} />
              ) : (
                <div className="w-5 h-5 rounded-full border-2 border-slate-200" />
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-500 italic">Sessions are first-come, first-served. Maximum capacity applies.</p>
    </div>
  );
};

const ExperiencedPaddlerForm = ({ onCancel }: { onCancel: () => void }) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get("name"),
      email: formData.get("email"),
      phone: formData.get("phone"),
      yearsPaddling: formData.get("yearsPaddling"),
      experience: formData.get("experience")
    };

    try {
      const response = await fetch("/api/contact/experienced", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        const errData = await safeJson(response);
        throw new Error(errData.error || "Failed to send inquiry.");
      }

      setSubmitted(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="text-center p-8 space-y-6">
        <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto text-emerald-600">
          <CheckCircle2 size={40} />
        </div>
        <div className="space-y-2">
          <h3 className="text-2xl font-bold">Inquiry Sent!</h3>
          <p className="text-slate-600">Your details have been sent to info@putneybridgecc.co.uk. Our team will review your experience and get back to you shortly.</p>
        </div>
        <Button onClick={onCancel} className="w-full">Return</Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-6">
      <div className="space-y-2">
        <h3 className="text-2xl font-bold flex items-center gap-2">
          <ShieldCheck className="text-blue-500" />
          Expert Verification
        </h3>
        <p className="text-sm text-slate-500">Provide your paddling history for fast-track approval.</p>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-600 rounded-xl text-sm border border-red-100 flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label htmlFor="exp-name" className="text-xs font-bold uppercase text-slate-400">Full Name</label>
            <input id="exp-name" name="name" required defaultValue={user?.displayName || ""} className="w-full h-12 px-4 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all" />
          </div>
          <div className="space-y-1">
            <label htmlFor="exp-email" className="text-xs font-bold uppercase text-slate-400">Email Address</label>
            <input id="exp-email" name="email" type="email" required defaultValue={user?.email || ""} className="w-full h-12 px-4 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label htmlFor="exp-phone" className="text-xs font-bold uppercase text-slate-400">Mobile Phone</label>
            <input id="exp-phone" name="phone" required className="w-full h-12 px-4 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all" />
          </div>
          <div className="space-y-1">
            <label htmlFor="exp-years" className="text-xs font-bold uppercase text-slate-400">Years Paddling</label>
            <input id="exp-years" name="yearsPaddling" required className="w-full h-12 px-4 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all" />
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="exp-experience" className="text-xs font-bold uppercase text-slate-400">Experience Description</label>
          <textarea id="exp-experience" name="experience" required rows={4} placeholder="Describe your experience, certifications (BC/UKCC), and any clubs you've been a part of..." className="w-full p-4 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all resize-none" />
        </div>
      </div>

      <div className="flex gap-4">
        <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={loading} className="flex-1 bg-blue-600 hover:bg-blue-700">
          {loading ? "Sending..." : "Submit for Approval"}
        </Button>
      </div>
    </form>
  );
};

const ProfileForm = ({ onComplete, mode = "full" }: { onComplete: (data?: any) => void, mode?: "beginner" | "pro" | "full" | "contact" | "edit" | "admin" }) => {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasDisability, setHasDisability] = useState(profile?.hasDisability || false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(profile?.selectedPoolSessionId || "");

  const defaultFirstName = profile?.firstName || user?.displayName?.split(" ")[0] || "";
  const defaultLastName = profile?.lastName || user?.displayName?.split(" ").slice(1).join(" ") || "";

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    
    console.log("[ProfileForm] Submitting mode:", mode);
    
    if (mode === "beginner" && !selectedSessionId) {
      setError("Please select a pool session to proceed.");
      return;
    }

    setLoading(true);
    setError(null);
    const formData = new FormData(e.currentTarget);
    
    let nextStatus: OnboardingStatus = profile?.onboardingStatus || "none";
    if (mode === "beginner") nextStatus = "beginner_pending_payment";
    if (mode === "pro") nextStatus = "pro_pending_approval";
    if (mode === "full") nextStatus = "membership_paid";

    const pendingPath = sessionStorage.getItem("pending_onboarding_path");
    const rawFName = formData.get("firstName")?.toString().trim();
    const rawLName = formData.get("lastName")?.toString().trim();
    const fName = rawFName || profile?.firstName || "";
    const lName = rawLName || profile?.lastName || "";
    const eMail = (formData.get("email") as string) || profile?.email || user.email || "";

    const data: any = {
      uid: user.uid,
      firstName: fName,
      lastName: lName,
      displayName: (fName || lName) ? `${fName} ${lName}`.trim() : (profile?.displayName || "New Member"),
      email: eMail,
      onboardingStatus: nextStatus,
      mobileNumber: (formData.get("mobileNumber") as string) || profile?.mobileNumber || "",
      photoUrl: (formData.get("photoUrl") as string) || profile?.photoUrl || "",
      yearOfBirth: Number(formData.get("yearOfBirth")) || profile?.yearOfBirth || null,
      sex: (formData.get("sex") as string) || profile?.sex || "",
      emergencyContactName: (formData.get("emergencyContactName") as string) || profile?.emergencyContactName || "",
      emergencyContactPhone: (formData.get("emergencyContactPhone") as string) || profile?.emergencyContactPhone || "",
      emergencyContactRelationship: (formData.get("emergencyContactRelationship") as string) || profile?.emergencyContactRelationship || "",
    };

    if (pendingPath && (pendingPath === "beginner" || pendingPath === "pro" || pendingPath === "former")) {
      data.onboardingPath = pendingPath;
      sessionStorage.removeItem("pending_onboarding_path");
    }

    if (!profile?.role) {
      data.role = 'guest';
    }

    console.log("[ProfileForm] Data to save:", data);

    if (mode === "beginner") {
      data.selectedPoolSessionId = selectedSessionId;
    }

    if (mode === "contact") {
      data.houseNameNumberStreet = formData.get("houseNameNumberStreet") as string;
      data.town = formData.get("town") as string;
      data.postcode = formData.get("postcode") as string;
      data.emergencyContactName = formData.get("emergencyContactName") as string;
      data.emergencyContactPhone = formData.get("emergencyContactPhone") as string;
      data.emergencyContactRelationship = formData.get("emergencyContactRelationship") as string;
      data.onboardingStatus = "none"; // Keep at none until path selected
    }

    if (mode === "beginner" || mode === "full") {
      data.houseNameNumberStreet = formData.get("houseNameNumberStreet") as string;
      data.town = formData.get("town") as string;
      data.county = formData.get("county") as string;
      data.postcode = formData.get("postcode") as string;
      data.hasDisability = hasDisability;
      data.disabilityDetails = formData.get("disabilityDetails") as string;
      data.mobileNumber = formData.get("mobileNumber") as string;
      data.yearOfBirth = Number(formData.get("yearOfBirth"));
      data.sex = formData.get("sex") as string;
      // Ensure emergency contact is collected for beginners too
      data.emergencyContactName = formData.get("emergencyContactName") as string;
      data.emergencyContactPhone = formData.get("emergencyContactPhone") as string;
      data.emergencyContactRelationship = formData.get("emergencyContactRelationship") as string;
    }

    if (mode === "pro" || mode === "full") {
      data.yearsPaddling = formData.get("yearsPaddling") as string;
      data.britishCanoeingMember = formData.get("britishCanoeingMember") === "on";
      data.britishCanoeingAwards = formData.get("britishCanoeingAwards") as string; // Added for BC details
      data.paddlingDescription = formData.get("paddlingDescription") as string;
    }

    if (mode === "full") {
      data.emergencyContactName = formData.get("emergencyContactName") as string;
      data.emergencyContactPhone = formData.get("emergencyContactPhone") as string;
      data.emergencyContactRelationship = formData.get("emergencyContactRelationship") as string;
      data.newsletter = formData.get("newsletter") === "on";
      data.includeInDirectory = formData.get("includeInDirectory") === "on";
      data.interestedInSeaKayaking = formData.get("interestedInSeaKayaking") === "on";
      data.interestedInRacing = formData.get("interestedInRacing") === "on";
      data.racingDivision = formData.get("racingDivision") as string;
      data.howDidYouHear = formData.get("howDidYouHear") as string;
    }

    try {
      if (db) {
        const userRef = doc(db, "users", user.uid);
        await setDoc(userRef, data, { merge: true });
        console.log("[ProfileForm] Firestore update successful");
      }
      
      if (supabase) {
        const supData: any = {
           id: user.uid,
           email: data.email,
           display_name: `${data.firstName} ${data.lastName}`,
           first_name: data.firstName,
           last_name: data.lastName,
           onboarding_status: data.onboardingStatus,
           mobile_number: data.mobileNumber,
           photo_url: data.photoUrl,
           house_street: data.houseNameNumberStreet,
           town: data.town,
           county: data.county,
           postcode: data.postcode,
           birth_year: data.yearOfBirth,
           gender: data.sex,
           years_paddling: data.yearsPaddling,
           awards: data.britishCanoeingAwards,
           bc_member: data.britishCanoeingMember,
           paddling_desc: data.paddlingDescription,
           emergency_contact_name: data.emergencyContactName,
           emergency_contact_phone: data.emergencyContactPhone,
           emergency_contact_relationship: data.emergencyContactRelationship,
           newsletter: data.newsletter,
           has_disability: data.hasDisability,
           disability_details: data.disabilityDetails,
           updated_at: new Date().toISOString()
        };
        const { error: supErr } = await supabase.from('profiles').upsert(supData);
        if (supErr) console.error("[Supabase Profile Upsert Error]", supErr);
      }

      console.log("[ProfileForm] All steps complete, calling onComplete with data:", data);
      onComplete(data);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      }
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setLoading(false);
    }
  };

  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  
  useEffect(() => {
    const handleRedirect = (e: any) => {
      setRedirectUrl(e.detail.url);
    };
    window.addEventListener("STRIPE_REDIRECT_REQUESTED", handleRedirect as EventListener);
    return () => window.removeEventListener("STRIPE_REDIRECT_REQUESTED", handleRedirect as EventListener);
  }, []);

  if (redirectUrl) {
    return (
      <div className="flex flex-col items-center justify-center p-12 space-y-6 text-center animate-in fade-in duration-500 bg-white rounded-3xl border shadow-xl">
        <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-3xl flex items-center justify-center shadow-xl shadow-blue-100 ring-8 ring-blue-50">
          <Zap size={40} className="animate-pulse" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-slate-800 tracking-tight">Redirecting to Secure Payment</h2>
          <p className="text-slate-500 max-w-xs mx-auto">Your browser should automatically open the payment page.</p>
        </div>
        <div className="space-y-4 pt-4 w-full">
          <a href={redirectUrl} target="_blank" rel="noopener noreferrer" className="block">
             <Button size="lg" className="w-full h-16 text-xl font-bold rounded-2xl shadow-xl shadow-blue-100 bg-blue-600 hover:bg-blue-700">
               Click here to pay now
               <ArrowRight className="ml-2" />
             </Button>
          </a>
          <button onClick={() => setRedirectUrl(null)} className="block mx-auto text-sm font-medium text-slate-400 hover:text-slate-600 underline underline-offset-4">
            Cancel and try again
          </button>
        </div>
      </div>
    );
  }

  if (mode === "contact") {
    return (
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="p-4 bg-red-50 text-red-700 rounded-lg flex items-center gap-2 text-sm border border-red-100">
            <AlertCircle size={18} />
            {error}
          </div>
        )}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label htmlFor="p-firstName" className="text-sm font-medium">First Name</label>
            <input id="p-firstName" name="firstName" required className="w-full p-2 border rounded-lg" defaultValue={defaultFirstName} />
          </div>
          <div className="space-y-2">
            <label htmlFor="p-lastName" className="text-sm font-medium">Last Name</label>
            <input id="p-lastName" name="lastName" required className="w-full p-2 border rounded-lg" defaultValue={defaultLastName} />
          </div>
          <div className="space-y-2">
            <label htmlFor="p-email" className="text-sm font-medium">Email</label>
            <input 
              id="p-email"
              name="email" 
              type="email"
              required
              className="w-full p-2 border rounded-lg" 
              defaultValue={profile?.email || user?.email || ""} 
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="p-mobileNumber" className="text-sm font-medium">Mobile Phone</label>
            <input id="p-mobileNumber" name="mobileNumber" required type="tel" className="w-full p-2 border rounded-lg" defaultValue={profile?.mobileNumber} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <label htmlFor="p-address" className="text-sm font-medium">Address (Street, Number)</label>
            <input id="p-address" name="houseNameNumberStreet" required className="w-full p-2 border rounded-lg" defaultValue={profile?.houseNameNumberStreet} />
          </div>
          <div className="space-y-2">
            <label htmlFor="p-town" className="text-sm font-medium">Town</label>
            <input id="p-town" name="town" required className="w-full p-2 border rounded-lg" defaultValue={profile?.town} />
          </div>
          <div className="space-y-2">
            <label htmlFor="p-postcode" className="text-sm font-medium">Postcode</label>
            <input id="p-postcode" name="postcode" required className="w-full p-2 border rounded-lg" defaultValue={profile?.postcode} />
          </div>
        </div>

        <div className="space-y-4 pt-6 border-t border-slate-100">
          <div className="flex items-center gap-2 pb-2">
            <Heart size={20} className="text-red-500" />
            <h3 className="font-bold text-lg">Emergency Contact Information</h3>
          </div>
          <p className="text-xs text-slate-500 italic mb-2">This MUST be someone else reachable in an emergency.</p>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="p-emergencyContactName" className="text-sm font-medium">Contact Name *</label>
              <input id="p-emergencyContactName" name="emergencyContactName" required className="w-full p-2 border rounded-lg bg-slate-50/50" defaultValue={profile?.emergencyContactName} />
            </div>
            <div className="space-y-2">
              <label htmlFor="p-emergencyContactPhone" className="text-sm font-medium text-red-600">EMERGENCY Phone Number *</label>
              <input id="p-emergencyContactPhone" name="emergencyContactPhone" type="tel" required className="w-full p-2 border rounded-lg border-red-200 bg-red-50/10 focus:ring-red-500" placeholder="Must be different from yours" defaultValue={profile?.emergencyContactPhone} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label htmlFor="p-emergencyContactRelationship" className="text-sm font-medium">Relationship *</label>
              <input id="p-emergencyContactRelationship" name="emergencyContactRelationship" required className="w-full p-2 border rounded-lg bg-slate-50/50" placeholder="e.g. Spouse, Parent, Friend" defaultValue={profile?.emergencyContactRelationship} />
            </div>
          </div>
        </div>

        <Button type="submit" disabled={loading} className="w-full h-12 text-lg font-bold">
          {loading ? "Saving..." : "Save & Continue"}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8 bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
      {error && (
        <div className="p-4 bg-red-50 text-red-700 rounded-lg flex items-center gap-2 text-sm border border-red-100">
          <AlertCircle size={18} />
          {error}
        </div>
      )}
      {mode === "beginner" && (
        <div className="space-y-6 pb-8 border-b">
          <div className="space-y-1">
            <h3 className="text-xl font-bold">1. Select Pool Session</h3>
            <p className="text-sm text-slate-500">Choose a Wednesday evening session for your assessment.</p>
          </div>
          <PoolSessionPicker selectedId={selectedSessionId} onSelect={setSelectedSessionId} />
        </div>
      )}

      {/* Personal & Health Details - Stage 2 for Beginners/Full Profile */}
      {( (mode === "beginner" && (!profile?.yearOfBirth || !profile?.mobileNumber || !profile?.sex)) || (mode === "full" && !profile?.yearOfBirth) || mode === "edit") && (
        <div className="space-y-6">
          {(!profile?.firstName || !profile?.lastName) && (
            <div className="grid md:grid-cols-2 gap-4 animate-in slide-in-from-top-2 duration-300">
               <div className="space-y-2">
                 <label htmlFor="f-firstName" className="text-sm font-medium">First Name *</label>
                 <input id="f-firstName" name="firstName" required className="w-full p-2 border rounded-lg bg-emerald-50/20" defaultValue={profile?.firstName} />
               </div>
               <div className="space-y-2">
                 <label htmlFor="f-lastName" className="text-sm font-medium">Last Name *</label>
                 <input id="f-lastName" name="lastName" required className="w-full p-2 border rounded-lg bg-emerald-50/20" defaultValue={profile?.lastName} />
               </div>
            </div>
          )}

          {/* Address for Beginners if missing */}
          {(mode === "beginner" && (!profile?.houseNameNumberStreet || !profile?.postcode)) && (
            <div className="space-y-4 animate-in slide-in-from-top-2 duration-300">
              <div className="p-4 bg-emerald-50/30 rounded-xl border border-emerald-100/50 space-y-4">
                <div className="flex items-center gap-2 text-emerald-700 font-bold text-sm">
                  <MapPin size={16} /> Home Address
                </div>
                <div className="space-y-2">
                  <label htmlFor="f-address" className="text-xs font-bold uppercase tracking-wider text-slate-500">Street Address *</label>
                  <input id="f-address" name="houseNameNumberStreet" required className="w-full p-2 border rounded-lg bg-white" defaultValue={profile?.houseNameNumberStreet} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label htmlFor="f-town" className="text-xs font-bold uppercase tracking-wider text-slate-500">Town *</label>
                    <input id="f-town" name="town" required className="w-full p-2 border rounded-lg bg-white" defaultValue={profile?.town} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="f-postcode" className="text-xs font-bold uppercase tracking-wider text-slate-500">Postcode *</label>
                    <input id="f-postcode" name="postcode" required className="w-full p-2 border rounded-lg bg-white" defaultValue={profile?.postcode} />
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <h3 className="font-bold text-lg border-b pb-2 flex items-center gap-2">
              <Users size={20} className="text-emerald-600" />
              {mode === "edit" ? "Health & Personal Details" : "2. Health & Personal Details"}
            </h3>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2 md:col-span-2">
                <label htmlFor="f-mobileNumber" className="text-sm font-medium flex items-center gap-2">
                  <CreditCard size={16} className="text-slate-400" />
                  Mobile Phone *
                </label>
                <input 
                  id="f-mobileNumber" 
                  name="mobileNumber" 
                  required 
                  type="tel" 
                  className="w-full p-3 border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all" 
                  defaultValue={profile?.mobileNumber} 
                  placeholder="e.g. 07700 900000" 
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="f-yearOfBirth" className="text-sm font-medium">Year of Birth *</label>
                <select id="f-yearOfBirth" name="yearOfBirth" required className="w-full p-3 border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all" defaultValue={profile?.yearOfBirth || ""}>
                  <option value="">Select Year</option>
                  {Array.from({ length: 107 }, (_, i) => 2026 - i).map(year => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="f-sex" className="text-sm font-medium">Sex *</label>
                <select id="f-sex" name="sex" required className="w-full p-3 border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all" defaultValue={profile?.sex}>
                  <option value="">Select...</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                  <option value="prefer-not-to-say">Prefer not to say</option>
                </select>
              </div>
            </div>

            <div className="space-y-4 md:col-span-2 py-4 border-t border-b border-slate-50">
              <label htmlFor="f-hasDisability" className="flex items-center gap-2 cursor-pointer">
                <input 
                  id="f-hasDisability"
                  type="checkbox" 
                  checked={hasDisability} 
                  onChange={(e) => setHasDisability(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded"
                />
                <span className="text-sm font-medium">Details of disability or long term illness?</span>
              </label>
              {hasDisability && (
                <textarea 
                  id="f-disabilityDetails"
                  name="disabilityDetails" 
                  placeholder="Please provide details..."
                  className="w-full p-2 border rounded-lg mt-2" 
                  defaultValue={profile?.disabilityDetails} 
                />
              )}
            </div>
          </div>
        </div>
      )}

      {mode === "edit" && (
        <div className="space-y-4 pt-6 border-t border-slate-200">
          <h3 className="font-bold text-lg border-b pb-2 flex items-center gap-2">
            <Anchor size={20} className="text-emerald-600" />
            Home Address
          </h3>
          <div className="space-y-2">
            <label htmlFor="f-address" className="text-sm font-medium">House Name/Number and Street *</label>
            <input id="f-address" name="houseNameNumberStreet" required className="w-full p-2 border rounded-lg" defaultValue={profile?.houseNameNumberStreet} />
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label htmlFor="f-town" className="text-sm font-medium">Town *</label>
              <input id="f-town" name="town" required className="w-full p-2 border rounded-lg" defaultValue={profile?.town} />
            </div>
            <div className="space-y-2">
              <label htmlFor="f-county" className="text-sm font-medium">County *</label>
              <input id="f-county" name="county" required className="w-full p-2 border rounded-lg" defaultValue={profile?.county} />
            </div>
            <div className="space-y-2">
              <label htmlFor="f-postcode" className="text-sm font-medium">Postcode *</label>
              <input id="f-postcode" name="postcode" required className="w-full p-2 border rounded-lg" defaultValue={profile?.postcode} />
            </div>
          </div>
        </div>
      )}

      {(mode === "pro" || mode === "full") && (
        <div className="space-y-4">
          <h3 className="font-bold text-lg border-b pb-2 flex items-center gap-2">
            <Waves size={20} className="text-emerald-600" />
            Paddling Experience & Qualifications
          </h3>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Number of years you have been paddling *</label>
              <select name="yearsPaddling" required className="w-full p-2 border rounded-lg" defaultValue={profile?.yearsPaddling}>
                <option value="">Select...</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
                <option value="Over 5">Over 5</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">British Canoeing Member?</label>
              <div className="flex items-center gap-4 h-10">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" name="britishCanoeingMember" defaultChecked={profile?.britishCanoeingMember} className="w-4 h-4 text-emerald-600 rounded" />
                  <span className="text-sm">Yes</span>
                </label>
                <input 
                  name="britishCanoeingAwards" 
                  placeholder="Membership Number / Awards" 
                  className="flex-1 p-2 border rounded-lg text-sm" 
                  defaultValue={profile?.britishCanoeingAwards} 
                />
              </div>
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium">Where and when did you paddle? (General description) *</label>
              <textarea name="paddlingDescription" required className="w-full p-2 border rounded-lg" defaultValue={profile?.paddlingDescription} />
            </div>
            {mode === "pro" && (
              <div className="md:col-span-2 p-4 bg-amber-50 rounded-lg border border-amber-200 text-amber-800 text-sm italic">
                Note: It is up to the leaders to grant you membership without pool experience based on your description.
              </div>
            )}
          </div>
        </div>
      )}

      {mode === "full" && (
        <div className="space-y-4">
          <h3 className="font-bold text-lg border-b pb-2 flex items-center gap-2">
            <MessageSquare size={20} className="text-emerald-600" />
            Interests & Preferences
          </h3>
          <div className="grid md:grid-cols-2 gap-4">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="newsletter" defaultChecked={profile?.newsletter} />
              <span className="text-sm">Subscribe to Newsletter</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="includeInDirectory" defaultChecked={profile?.includeInDirectory} />
              <span className="text-sm">Include in Member Directory</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="interestedInSeaKayaking" defaultChecked={profile?.interestedInSeaKayaking} />
              <span className="text-sm">Interested in Sea Kayaking</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="interestedInRacing" defaultChecked={profile?.interestedInRacing} />
              <span className="text-sm">Interested in Racing (K1/K2)</span>
            </label>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium">Racing division (if applicable)</label>
              <input name="racingDivision" className="w-full p-2 border rounded-lg" defaultValue={profile?.racingDivision} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium">How did you hear about us?</label>
              <input name="howDidYouHear" className="w-full p-2 border rounded-lg" defaultValue={profile?.howDidYouHear} />
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4 pt-6 border-t border-slate-100">
        <div className="flex items-center gap-2 pb-2">
          <Heart size={20} className="text-red-500" />
          <h3 className="font-bold text-lg">Emergency Contact Information</h3>
        </div>
        <p className="text-[10px] text-slate-500 italic mb-2 uppercase tracking-wide">REQUIRED: This person MUST be reachable while you are on the water.</p>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label htmlFor="f-emergencyContactName" className="text-xs font-bold uppercase tracking-wider text-slate-500">Contact Name *</label>
            <input id="f-emergencyContactName" name="emergencyContactName" required className="w-full p-2 border rounded-lg bg-white shadow-sm" defaultValue={profile?.emergencyContactName} placeholder="Full Name" />
          </div>
          <div className="space-y-1">
            <label htmlFor="f-emergencyContactPhone" className="text-xs font-bold uppercase tracking-wider text-red-500">EMERGENCY Phone Number *</label>
            <input id="f-emergencyContactPhone" name="emergencyContactPhone" required type="tel" className="w-full p-2 border border-red-100 rounded-lg bg-red-50/10 shadow-sm" defaultValue={profile?.emergencyContactPhone} placeholder="Emergency Phone" />
          </div>
          <div className="space-y-1 md:col-span-2">
            <label htmlFor="f-emergencyContactRelationship" className="text-xs font-bold uppercase tracking-wider text-slate-500">Relationship *</label>
            <input id="f-emergencyContactRelationship" name="emergencyContactRelationship" required className="w-full p-2 border rounded-lg bg-white shadow-sm" placeholder="e.g. Spouse, Partner, Parent, Child" defaultValue={profile?.emergencyContactRelationship} />
          </div>
        </div>
      </div>

      <Button type="submit" disabled={loading} className="w-full h-14 text-lg font-bold shadow-xl shadow-emerald-100">
        {loading ? "Saving..." : "Save Profile & Continue"}
      </Button>
    </form>
  );
};

const Onboarding = () => {
  const { user, profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, alert } = useUI();
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(profile?.selectedPoolSessionId);
  const [showExpertForm, setShowExpertForm] = useState(false);
  const [hasInitiatedPayment, setHasInitiatedPayment] = useState(false);
  const [showLongWait, setShowLongWait] = useState(false);

  const setPath = async (path: "beginner" | "pro" | "former") => {
    if (!user) return;
    try {
      if (db) await updateDoc(doc(db, "users", user.uid), { onboardingPath: path });
      syncProfileToSupabase(user.uid, { onboardingPath: path });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const handlePayment = useCallback(async (type: string, amountOverride?: number, poolSessionId?: string) => {
    if (!user) return signIn();
    setLoading(true);
    try {
      console.log(`[Stripe] Creating ${type} session for ${user.email} (Amount: ${amountOverride})`);
      const response = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          type, 
          userId: user.uid, 
          userEmail: user.email,
          amount: amountOverride,
          selectedPoolSessionId: poolSessionId || profile?.selectedPoolSessionId || selectedSessionId || ""
        }),
      });
      
      const data = await safeJson(response);
      if (!response.ok) throw new Error(data.error || `Request failed with status ${response.status}`);

      if (data.url) {
        openPaymentUrl(data.url);
      } else if (data.id) {
        const publishableKey = data.publishableKey || (import.meta as any).env.VITE_STRIPE_PUBLISHABLE_KEY;
        const stripe = await (window as any).Stripe(publishableKey);
        await stripe.redirectToCheckout({ sessionId: data.id });
      }
    } catch (error: any) {
      setError(error.message || "Payment failed");
      alert("Payment Error: " + (error.message || "Unknown error"));
      setHasInitiatedPayment(false);
    } finally {
      setLoading(false);
    }
  }, [user, profile, selectedSessionId, alert]);

  const handleGeneralPayment = useCallback((type: "pool_session" | "membership") => {
    if (type === "pool_session") {
      const isBeginner = profile?.onboardingPath === "beginner";
      const isChildFlag = profile?.yearOfBirth ? (new Date().getFullYear() - profile.yearOfBirth < 18) : false;
      const amountOverride = isChildFlag ? 500 : (isBeginner ? 1200 : 1000);
      handlePayment("pool_session", amountOverride);
    } else {
      handlePayment(type);
    }
  }, [profile, handlePayment]);

  const handleBeginnerFormComplete = useCallback(async (data?: any) => {
    const yob = data?.yearOfBirth || profile?.yearOfBirth;
    const isChildVal = yob ? (new Date().getFullYear() - Number(yob) < 18) : false;
    const amount = isChildVal ? 500 : 1200;
    
    setHasInitiatedPayment(true);
    try {
      if (user && db) {
        await setDoc(doc(db, "users", user.uid), {
          onboardingStatus: "beginner_pending_payment",
          selectedPoolSessionId: data?.selectedPoolSessionId || profile?.selectedPoolSessionId || null
        }, { merge: true });
      }
      handlePayment("pool_session", amount, data?.selectedPoolSessionId);
    } catch (e) {
      handlePayment("pool_session", amount, data?.selectedPoolSessionId);
    }
  }, [user, profile, handlePayment]);

  const hasOnboardingPath = !!profile?.onboardingPath;

  useEffect(() => {
    if (!hasOnboardingPath && user && db && profile !== undefined) {
      const timer = setTimeout(() => {
        if (!profile?.onboardingPath) {
          console.log("[Onboarding] Auto-setting path to beginner");
          const userRef = doc(db, "users", user.uid);
          setDoc(userRef, { onboardingPath: "beginner" }, { merge: true });
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [hasOnboardingPath, user, db, profile]);

  useEffect(() => {
    if (profile?.selectedPoolSessionId && !selectedSessionId) {
      setSelectedSessionId(profile.selectedPoolSessionId);
    }
  }, [profile, selectedSessionId]);

  useEffect(() => {
    const checkPathPreference = async () => {
      if (user && profile && !profile.onboardingPath) {
        const pref = sessionStorage.getItem("pending_onboarding_path");
        if (pref === "former" || pref === "beginner" || pref === "pro") {
          sessionStorage.removeItem("pending_onboarding_path");
          await setPath(pref as any);
        }
      }
    };
    checkPathPreference();
  }, [user, profile]);

  useEffect(() => {
    if (!hasOnboardingPath && user) {
      const t = setTimeout(() => setShowLongWait(true), 3000);
      return () => clearTimeout(t);
    }
  }, [hasOnboardingPath, user]);

  const isChild = profile?.yearOfBirth ? (new Date().getFullYear() - profile.yearOfBirth < 18) : false;

  useEffect(() => {
    if (profile?.onboardingStatus === "beginner_pending_payment" && !loading && !hasInitiatedPayment) {
        const timer = setTimeout(() => {
          setHasInitiatedPayment(true);
          handlePayment("pool_session", isChild ? 500 : 1200);
        }, 1000);
        return () => clearTimeout(timer);
    }
  }, [profile?.onboardingStatus, loading, hasInitiatedPayment, isChild, handlePayment]);

  const steps = useMemo(() => {
    const beginnerSteps = [
      { id: "beginner_init", title: "Join Club", desc: "Provide your details to begin the registration process.", component: <ProfileForm mode="beginner" onComplete={handleBeginnerFormComplete} /> },
      { id: "beginner_pending_payment", title: "Assessment Fee", desc: "£12 assessment fee for your initial pool session.", component: (
        <div className="flex flex-col items-center justify-center p-12 text-center space-y-6">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600" />
          <p className="text-slate-600 font-medium tracking-tight">Redirecting to secure payment...</p>
          <div className="space-y-4 w-full max-w-sm">
            <Button 
              className="w-full h-16 text-xl font-bold rounded-2xl bg-emerald-600 hover:bg-emerald-700 shadow-xl shadow-emerald-100"
              onClick={() => handlePayment("pool_session", isChild ? 500 : 1200)}
            >
              Pay Now (£{isChild ? 5 : 12})
              <ArrowRight className="ml-2" />
            </Button>
          </div>
        </div>
      ) },
      { id: "beginner_paid", title: "Assessment Phase", desc: (
        <div className="space-y-2">
          <p>Please attend a few Wednesday pool sessions.</p>
          {profile?.bookedSessionDate && (
            <p className="text-emerald-600 font-bold">
              You have registered for your first pool session on {format(new Date(profile.bookedSessionDate.toDate ? profile.bookedSessionDate.toDate() : profile.bookedSessionDate), "EEEE, MMMM do")}.
            </p>
          )}
          <p className="text-slate-500 text-sm">Your instructors will be keen to meet you and share their experience and assess your level and fitness and progress to new adventures.</p>
        </div>
      ) },
      { id: "pending_leader_approval", title: "Assessment Review", desc: (
        <div className="space-y-2">
          <p>A leader is reviewing your status.</p>
          {profile?.bookedSessionDate && (
             <p className="text-emerald-600 font-bold">
               You have registered for your first pool session on {format(new Date(profile.bookedSessionDate.toDate ? profile.bookedSessionDate.toDate() : profile.bookedSessionDate), "EEEE, MMMM do")}.
             </p>
          )}
          <p className="text-slate-500 text-sm italic">
            Your instructors will be keen to meet you and share their experience and assess your level and fitness and progress to new adventures.
          </p>
        </div>
      ) },
      { id: "trial_active", title: "River Trials", desc: "You are approved for river trials!" },
      { id: "pool_passed", title: "Final Membership", desc: "Complete membership payment.", price: "£50", action: () => handleGeneralPayment("membership"), btnText: "Complete Membership (£50)" },
      { id: "membership_paid", title: "Welcome!", desc: "Full member.", component: (
        <div className="space-y-6 text-center py-8">
          <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 size={40} />
          </div>
          <h3 className="text-2xl font-bold">Welcome!</h3>
          <p className="text-slate-600">Your membership is now active.</p>
          <Button onClick={() => window.location.href = "/"} className="bg-emerald-600">Go to Dashboard</Button>
        </div>
      ) }
    ];

    const proSteps = [
      { id: "pro_init", title: "Experience", desc: "Tell us about your history.", component: <ProfileForm mode="pro" onComplete={() => {}} /> },
      { id: "pro_pending_approval", title: "Approval", desc: (
        <div className="space-y-2">
          <p>Leaders are reviewing your details and experience.</p>
          <p className="text-slate-500 text-sm italic">
            Your instructors will be keen to meet you and share their experience and assess your level and fitness and progress to new adventures.
          </p>
        </div>
      ), status: "Pending Approval" },
      { id: "pool_passed", title: "Membership", desc: "Approved! Pay subscription.", price: "£50", action: () => handleGeneralPayment("membership"), btnText: "Pay £50" },
      { id: "membership_paid", title: "Full Profile", desc: "Complete your details.", component: <ProfileForm mode="full" onComplete={() => {}} /> }
    ];

    const formerSteps = [
      { id: "former_init", title: "Renewal", desc: "Pay subscription.", price: "£50", action: () => handleGeneralPayment("membership"), btnText: "Pay £50" },
      { id: "membership_paid", title: "Update Profile", desc: "Check your details.", component: <ProfileForm mode="full" onComplete={() => {}} /> }
    ];

    return (profile?.onboardingPath === "beginner" ? beginnerSteps : profile?.onboardingPath === "pro" ? proSteps : formerSteps) as any[];
  }, [profile?.onboardingPath, isChild, handleBeginnerFormComplete, handleGeneralPayment, handlePayment]);

  const currentStepIndex = steps.findIndex(s => s.id === (profile?.onboardingStatus || (profile?.onboardingPath === "beginner" ? "beginner_init" : profile?.onboardingPath === "pro" ? "pro_init" : "former_init")));
  const currentStep = steps[currentStepIndex] || steps[0];

  const handleResetOnboarding = async () => {
    if (!user) return;
    confirm("Are you sure? This will reset your progress.", async () => {
      setLoading(true);
      try {
        if (db) {
          await deleteDoc(doc(db, "users", user.uid));
          window.location.reload();
        }
      } catch (e: any) {
        alert("Reset failed: " + e.message);
      } finally {
        setLoading(false);
      }
    });
  };

  if (authLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60rem] space-y-4 text-center">
        <Waves className="animate-bounce text-emerald-600 w-12 h-12" />
        <p className="text-slate-500 animate-pulse">Loading status...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto py-20 px-4 text-center space-y-8">
        <Anchor size={48} className="mx-auto text-emerald-600" />
        <h1 className="text-5xl font-extrabold text-slate-900 tracking-tight">Ready to Join PBCC?</h1>
        <Button size="lg" onClick={signIn} className="h-16 px-10 text-xl font-bold bg-emerald-600 rounded-2xl shadow-xl shadow-emerald-50">
          Sign In to Join
        </Button>
        {!showExpertForm ? (
          <div className="pt-12 grid md:grid-cols-3 gap-8">
            <Card className="p-6 cursor-pointer hover:border-emerald-500 transition-all" onClick={() => { sessionStorage.setItem("pending_onboarding_path", "beginner"); signIn(); }}>
              <Waves className="text-emerald-500 mb-2 mx-auto" />
              <h3 className="font-bold">Beginner</h3>
              <p className="text-sm text-slate-500">New to paddling.</p>
            </Card>
            <Card className="p-6 cursor-pointer hover:border-blue-500 transition-all" onClick={() => setShowExpertForm(true)}>
              <ShieldCheck className="text-blue-500 mb-2 mx-auto" />
              <h3 className="font-bold">Experienced</h3>
              <p className="text-sm text-slate-500">Fast-track approval.</p>
            </Card>
            <Card className="p-6 cursor-pointer hover:border-purple-500 transition-all" onClick={() => { sessionStorage.setItem("pending_onboarding_path", "former"); signIn(); }}>
              <History className="text-purple-500 mb-2 mx-auto" />
              <h3 className="font-bold">Returning</h3>
              <p className="text-sm text-slate-500">Welcome back!</p>
            </Card>
          </div>
        ) : (
          <div className="max-w-xl mx-auto">
            <ExperiencedPaddlerForm onCancel={() => setShowExpertForm(false)} />
          </div>
        )}
      </div>
    );
  }

  if (!hasOnboardingPath) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40rem] space-y-6 text-center">
        <Waves className="animate-spin text-emerald-600 w-16 h-16" />
        <h2 className="text-2xl font-bold tracking-tight">Preparing your profile...</h2>
        {showLongWait && <Button variant="outline" onClick={() => setPath("beginner")}>Start Assessment Path</Button>}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-12 px-4 space-y-8">
      <div className="flex justify-between items-center bg-white p-6 rounded-[2rem] border shadow-sm">
        <div>
          <Badge variant="info" className="mb-2">Step {currentStepIndex + 1} of {steps.length}</Badge>
          <h2 className="text-3xl font-extrabold tracking-tight">Onboarding: {profile?.onboardingPath}</h2>
        </div>
        <Button variant="ghost" size="sm" onClick={handleResetOnboarding} className="text-red-400 hover:text-red-600 hover:bg-red-50">Reset Progress</Button>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-4">
          {steps.map((step, idx) => {
            const isCurrent = idx === currentStepIndex;
            const isCompleted = idx < currentStepIndex;
            return (
              <div key={step.id} className={cn("p-4 rounded-xl border flex items-center gap-3 transition-all", 
                isCurrent ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500" : "border-slate-100 bg-white opacity-50")}>
                <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-xs",
                  isCompleted ? "bg-emerald-500 text-white" : isCurrent ? "bg-emerald-600 text-white" : "bg-slate-200")}>
                  {isCompleted ? <CheckCircle2 size={14} /> : idx + 1}
                </div>
                <h4 className="font-bold text-sm">{step.title}</h4>
              </div>
            );
          })}
        </div>

        <div className="lg:col-span-2">
          <Card className="p-8 space-y-6 border-none shadow-xl shadow-slate-200/50 rounded-[2rem]">
            <div className="space-y-2">
              <h3 className="text-2xl font-bold tracking-tight">{currentStep.title}</h3>
              <p className="text-slate-600">{currentStep.desc}</p>
            </div>
            {currentStep.component || (
              <div className="flex flex-col items-center justify-center p-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200 space-y-4">
                <Badge variant="warning" className="py-2 px-4 text-lg">{currentStep.status || "In Review"}</Badge>
                <p className="text-sm text-slate-500 italic">Our leaders will review your status shortly.</p>
                {currentStep.action && (
                  <Button onClick={currentStep.action} disabled={loading} className="w-full h-14 text-lg font-bold bg-emerald-600 mt-4 rounded-xl">
                    {loading ? "Processing..." : currentStep.btnText}
                  </Button>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

const PaymentSuccess = () => {
  const { user, profile } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const type = searchParams.get("type");
  const amount = searchParams.get("amount");
  const sessionId = searchParams.get("session_id");
  const [isVerified, setIsVerified] = useState(false);
  const [statusCheckCount, setStatusCheckCount] = useState(0);
  const [isVerifyingManually, setIsVerifyingManually] = useState(false);

  const handleManualVerify = async () => {
    if (!sessionId || !user) return;
    setIsVerifyingManually(true);
    try {
      console.log("[Admin Sync] Attempting primary backend sync...");
      const resp = await fetch("/api/admin/verify-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, userId: user.uid })
      });
      
      const data = await safeJson(resp);
      
      if (resp.ok) {
        setIsVerified(true);
        console.log("[Admin Sync] Backend sync successful.");
      } else {
        console.warn("[Admin Sync] Backend failed, attempting Hybrid Sync fallback...", data.error);
        
        // --- HYBRID SYNC FALLBACK ---
        // 1. Fetch raw session data from Stripe via server (server can talk to Stripe)
        const stripeResp = await fetch(`/api/admin/stripe-session-data?sessionId=${sessionId}`);
        const stripeData = await safeJson(stripeResp);
        
        if (!stripeResp.ok || !stripeData.session) {
          throw new Error(stripeData.error || "Could not retrieve session from Stripe.");
        }

        const session = stripeData.session;
        const { userId: targetUserId, type: paymentType } = session.metadata || {};

        if (!targetUserId || !paymentType) {
          throw new Error("Stripe session is missing critical metadata (userId or type).");
        }

        // 2. Prepare payment record
        const paymentRecord = {
          uid: targetUserId,
          amount: session.amount_total / 100,
          type: paymentType,
          status: "completed",
          timestamp: serverTimestamp(),
          stripeSessionId: session.id,
          description: `Manual Sync: ${paymentType.replace('_', ' ')}`,
          email: session.customer_details?.email || user.email,
          manualSyncBy: user.uid,
          manualSyncAt: serverTimestamp()
        };

        // 3. Perform client-side write (Client has verified Firestore permissions)
        if (db) {
          const paymentsRef = collection(db, "payments");
          await addDoc(paymentsRef, paymentRecord);
        }
        if (supabase) {
           await supabase.from('payments').insert({
              user_id: targetUserId,
              user_email: paymentRecord.email,
              amount: paymentRecord.amount,
              type: paymentRecord.type,
              status: 'completed',
              description: paymentRecord.description || 'Manual Admin Sync'
           });
        }

        // 4. Update user status if necessary
        if (paymentType === "membership") {
          const expiry = addDays(new Date(), 365);
          if (db) {
            await updateDoc(doc(db, "users", targetUserId), {
              onboardingStatus: "membership_paid",
              role: "member",
              membershipExpiry: expiry
            });
          }
          syncProfileToSupabase(targetUserId, { 
             onboardingStatus: "membership_paid", 
             role: "member",
             expiresOn: expiry
          });
        } else if (paymentType === "pool_session") {
          if (db) {
            await updateDoc(doc(db, "users", targetUserId), {
              onboardingStatus: "beginner_paid"
            });
          }
          syncProfileToSupabase(targetUserId, { onboardingStatus: "beginner_paid" });
        }

        setIsVerified(true);
        alert("Hybrid Sync Successful! Payment recorded via Supabase (and Firebase if available).");
      }
    } catch (e: any) {
      console.error("[Admin Sync Error]", e);
      alert(e.message || "Sync failed. Check logs for details.");
    } finally {
      setIsVerifyingManually(false);
    }
  };

  useEffect(() => {
    if (!user && !sessionId) return;
    
    // If we have a session ID but no user, we can't verify yet, but we shouldn't return if we want to show a prompt
    if (!user && sessionId) return;

    if (!user || !sessionId) return;

    // --- STATUS AUTO-BYPASS ---
    // If the profile already reflects the successful payment, don't wait for the payment record to appear
    if (type === "pool_session" && (profile?.onboardingStatus === "beginner_paid" || profile?.onboardingStatus === "pool_passed" || profile?.onboardingStatus === "membership_paid")) {
      setIsVerified(true);
      return;
    }
    if (type === "membership" && (profile?.onboardingStatus === "membership_paid" || profile?.role === "member" || profile?.role === "admin")) {
      setIsVerified(true);
      return;
    }

    // Poll Firestore for completion
    const q = query(
      collection(db, "payments"), 
      where("stripeSessionId", "==", sessionId),
      where("uid", "==", user.uid),
      where("status", "==", "completed")
    );

    const unsub = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        setIsVerified(true);
      }
    });

    const timer = setInterval(() => {
      setStatusCheckCount(prev => prev + 1);
    }, 2000);

    return () => {
      unsub();
      clearInterval(timer);
    };
  }, [user, sessionId]);

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto py-24 px-4 text-center space-y-8 animate-in fade-in zoom-in duration-500">
        <div className="w-24 h-24 bg-blue-100 text-blue-600 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-xl shadow-blue-100 ring-8 ring-blue-50">
          <ShieldCheck size={48} />
        </div>
        <div className="space-y-4">
          <h2 className="text-4xl font-extrabold text-slate-900 tracking-tight">Payment Received</h2>
          <p className="text-xl text-slate-600 max-w-md mx-auto leading-relaxed font-medium">
             Thank you! we've received your payment. Please sign in to verify your account and complete the process.
          </p>
        </div>
        
        <Card className="p-8 max-w-sm mx-auto shadow-2xl border-slate-100 rounded-[2rem]">
          <Button onClick={signIn} size="lg" className="w-full h-16 text-xl font-bold rounded-2xl shadow-xl shadow-emerald-200">
            Sign In to Verify
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-24 px-4 text-center space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
      <div className={cn(
        "inline-flex p-6 rounded-full shadow-xl transition-all duration-500 ring-8",
        isVerified ? "bg-emerald-100 text-emerald-600 shadow-emerald-100 ring-emerald-50" : "bg-blue-100 text-blue-600 shadow-blue-100 ring-blue-50"
      )}>
        {isVerified ? <CheckCircle2 size={64} /> : <Zap size={64} className="animate-pulse" />}
      </div>
      
      <div className="space-y-4">
        <h1 className="text-5xl font-black text-slate-900 tracking-tight">
          {isVerified ? "Payment Verified!" : "Processing Payment..."}
        </h1>
        <p className="text-xl text-slate-600 max-w-xl mx-auto leading-relaxed">
          {isVerified ? (
            <>Thank you, <b>{profile?.firstName || user?.displayName || "Member"}</b>. Your transaction of <b>£{amount}</b> has been successfully recorded.</>
          ) : (
            <>We are waiting for <b>Stripe</b> to confirm your payment. This usually takes a few seconds...</>
          )}
        </p>
        {!isVerified && (
          <div className="space-y-4 py-4 animate-in fade-in duration-1000">
            <p className="text-sm text-slate-400 italic">Syncing with Stripe... (Attempt {statusCheckCount})</p>
            <div className="flex flex-col gap-2 max-w-xs mx-auto">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => window.location.reload()}
                className="rounded-xl border-slate-200"
              >
                Refresh Check
              </Button>
              {(statusCheckCount > 3 || profile?.role === "admin") && (
                <div className="pt-4 mt-4 border-t border-slate-100 space-y-2">
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Still waiting?</p>
                  <Button 
                    variant="primary" 
                    size="sm" 
                    onClick={handleManualVerify} 
                    disabled={isVerifyingManually}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-100"
                  >
                    {isVerifyingManually ? "Verifying..." : "Manual Sync Payment"}
                  </Button>
                  <p className="text-[9px] text-slate-400">Forces a check of the Stripe session metadata.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <Card className="p-8 max-w-2xl mx-auto border-emerald-100 bg-white/50 backdrop-blur-sm shadow-xl rounded-3xl">
        <div className="space-y-6 text-left">
          <div className="flex items-start gap-4">
            <div className={cn(
               "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 transition-colors",
               isVerified ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-400"
            )}>
              <Mail size={24} />
            </div>
            <div>
              <h3 className="font-bold text-lg">Confirmation Email</h3>
              <p className="text-slate-600 text-sm">
                {isVerified 
                  ? <>We've sent a detailed receipt and next steps to <b>{user?.email}</b>.</>
                  : "We'll send your receipt as soon as the payment is confirmed."}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4 border-t pt-6 border-slate-100">
            <div className={cn(
               "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 transition-colors",
               isVerified ? "bg-purple-100 text-purple-600" : "bg-slate-100 text-slate-400"
            )}>
              <Users size={24} />
            </div>
            <div>
              <h3 className="font-bold text-lg">Club Officers</h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                {type === "pool_session" 
                  ? "Our instructors have been notified of your booking. They will expect you at the pool on the selected Wednesday at 7:30 PM."
                  : "Membership status has been updated. The committee is notified and you are now officially a part of PBCC!"}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4 border-t pt-6 border-slate-100">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center shrink-0">
              <CheckCircle2 size={24} />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-lg">Payment Details</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span className="text-slate-400 font-medium">Payment ID:</span>
                <span className="font-mono font-bold text-slate-600">{(sessionId || "").slice(0, 12)}...</span>
                <span className="text-slate-400 font-medium">Payment Type:</span>
                <span className="font-bold text-slate-600 capitalize">{type?.replace('_', ' ')}</span>
                <span className="text-slate-400 font-medium">Status:</span>
                <Badge variant={isVerified ? "success" : "warning"} className="w-fit">{isVerified ? "Completed" : "Processing"}</Badge>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex flex-col sm:flex-row gap-4 justify-center pt-8">
        <Button 
          size="lg" 
          onClick={() => navigate(type === "pool_session" ? "/onboarding" : "/dashboard")}
          className="h-16 px-10 text-xl font-bold rounded-2xl shadow-xl shadow-emerald-200"
          disabled={!isVerified}
        >
          {type === "pool_session" ? "Continue Onboarding" : "Go to Dashboard"}
          <ArrowRight className="ml-2" />
        </Button>
        <Link to="/events">
          <Button variant="outline" size="lg" className="h-16 px-10 text-xl font-bold rounded-2xl">
            Browse Events
          </Button>
        </Link>
      </div>
    </div>
  );
};

const GlobalContext = createContext<{ 
  allUsers: UserProfile[], 
  allBoats: Boat[],
  profile: UserProfile | null,
  visibility: any
}>({ allUsers: [], allBoats: [], profile: null, visibility: {} });

const useGlobal = () => useContext(GlobalContext);

// --- Component: Badge Helpers ---
const PoolNewRecruitIndicator = ({ participants }: { participants: string[] }) => {
  const { allUsers } = useGlobal();
  
  const newRecruitCount = participants.filter(pid => {
    const p = allUsers.find(u => u.uid === pid);
    return p && ["pending_leader_approval", "beginner_paid", "beginner_pending_payment", "trial_active", "pool_passed"].includes(p.onboardingStatus);
  }).length;

  if (newRecruitCount === 0) return null;
  return (
    <Badge variant="destructive" className="ml-2 bg-red-600 text-[10px] animate-pulse">
      {newRecruitCount} NEW RECRUIT{newRecruitCount > 1 ? "S" : ""}
    </Badge>
  );
};

const ParticipantBadge = ({ uid }: { uid: string }) => {
  const { allUsers } = useGlobal();
  const p = allUsers.find(u => u.uid === uid);
  
  if (!p) return <Badge variant="secondary" className="text-[10px]">...</Badge>;

  const name = p.firstName ? `${p.firstName} ${p.lastName}` : p.displayName || p.email;
  const isFullMember = p.role === "member" && p.onboardingStatus === "membership_paid";
  const isAdminOrLeader = p.role === "admin" || p.role === "leader" || p.role === "instructor" || p.role === "partner_club";
  
  // Level 1: Beginner/Unexperienced - Red
  // Level 3: Expert - Underlined
  const isLevel1 = p.paddlingLevel === 1;
  const isLevel3 = p.paddlingLevel === 3;
  
  const isNewRecruit = ["pending_leader_approval", "beginner_paid", "beginner_pending_payment", "trial_active", "pool_passed"].includes(p.onboardingStatus);
  // Red if explicitly Level 1 OR if it's a new recruit/non-member
  const isRed = isLevel1 || isNewRecruit || (!isFullMember && !isAdminOrLeader);
  
  return (
    <Badge 
      variant={isRed ? "destructive" : "secondary"} 
      className={cn(
        "text-[10px] transition-all", 
        isRed && "bg-red-600 text-white hover:bg-red-700 font-black animate-pulse",
        isLevel3 && "underline decoration-2 underline-offset-2"
      )}
    >
      {name}
    </Badge>
  );
};

const BoatBadge = ({ boatId }: { boatId: string }) => {
  const { allBoats } = useGlobal();
  const boat = allBoats.find(b => b.id === boatId);

  if (!boat) return null;
  return (
    <div className="flex items-center gap-2 text-xs font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-md border border-amber-100 w-fit">
      <Anchor size={12} />
      <span>{boat.name} ({boat.type})</span>
    </div>
  );
};

interface EventsProps {
  filterType?: string;
}

const PoolBookingModal = ({ isOpen, onClose, onConfirm, event, profile, formData, setFormData, isMember }: { 
  isOpen: boolean, 
  onClose: () => void, 
  onConfirm: () => void, 
  event: ClubEvent | null, 
  profile: UserProfile | null,
  formData: any,
  setFormData: any,
  isMember: boolean
}) => {
  if (!isOpen || !event) return null;

  const isImmune = profile?.role === "leader" || profile?.role === "instructor" || profile?.role === "admin";
  const basePrice = isImmune ? 0 : (isMember ? 10 : 12);
  const childPrice = formData.useChildCoupons ? 0 : (formData.childCount * 5);
  const total = basePrice + childPrice;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-[2rem] w-full max-w-md overflow-hidden shadow-2xl"
      >
        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-emerald-50/30">
          <div className="space-y-1">
            <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Booking Details</h2>
            <p className="text-slate-500 text-sm">Pool Session Assessment / Practice</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X size={24} className="text-slate-400" />
          </button>
        </div>
        
        <div className="p-8 space-y-6">
          <div className="space-y-4">
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Member Status:</span>
                <span className="font-bold">{isMember ? "Member" : (isImmune ? profile?.role : "Guest")}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Your Price:</span>
                <span className="font-bold">£{basePrice}</span>
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-sm font-bold text-slate-700 block text-center">Bringing Children? (+£5 each)</label>
              <div className="flex items-center justify-center gap-4">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setFormData({ ...formData, childCount: Math.max(0, formData.childCount - 1) })}
                >
                  -
                </Button>
                <span className="text-2xl font-black w-8 text-center">{formData.childCount}</span>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setFormData({ ...formData, childCount: formData.childCount + 1 })}
                >
                  +
                </Button>
              </div>
            </div>

            {formData.childCount > 0 && profile?.childCoupons && profile.childCoupons > 0 && (
              <label className="flex items-center gap-2 p-3 bg-emerald-50 rounded-xl border border-emerald-100 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={formData.useChildCoupons}
                  onChange={(e) => setFormData({ ...formData, useChildCoupons: e.target.checked })}
                  className="w-4 h-4 text-emerald-600 rounded"
                />
                <span className="text-xs font-medium text-emerald-800">
                  Use {Math.min(formData.childCount, profile.childCoupons)} pre-purchased child coupons? (Bal: {profile.childCoupons})
                </span>
              </label>
            )}

            <div className="space-y-2 pt-2 border-t text-center">
              <label className="text-[10px] uppercase font-bold text-slate-400 tracking-widest">Coupon Code (Instructors / Partner Clubs)</label>
              <input 
                type="text" 
                placeholder="PROMOCODE"
                className="w-full p-2 border rounded-lg text-center font-mono uppercase"
                value={formData.couponCode}
                onChange={(e) => setFormData({ ...formData, couponCode: e.target.value })}
              />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex flex-col items-center gap-4">
            <div className="text-center">
              <p className="text-xs text-slate-400 uppercase font-bold tracking-widest">Total Due</p>
              <h3 className="text-3xl font-black text-emerald-600">£{total}</h3>
              {formData.couponCode && (
                <p className="text-[10px] text-emerald-600 font-bold uppercase mt-1 animate-pulse">
                  Coupon applied at next step
                </p>
              )}
            </div>
            <Button className="w-full h-14 rounded-2xl text-lg font-black shadow-xl shadow-emerald-100" onClick={onConfirm}>
              {total > 0 ? "Pay & Book" : "Confirm Booking"}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

const BoatSelectionModal = ({ isOpen, onClose, onSelect, boats }: { isOpen: boolean, onClose: () => void, onSelect: (boatId: string) => void, boats: Boat[] }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-[2rem] w-full max-w-2xl overflow-hidden shadow-2xl"
      >
        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-emerald-50/30">
          <div className="space-y-1">
            <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
              <Anchor className="text-emerald-600" />
              Select a Boat for your Trip
            </h2>
            <p className="text-slate-500 text-sm italic">"A boat booking does not guarantee availability and that the Leader can swap boats around at their discretion"</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X size={24} className="text-slate-400" />
          </button>
        </div>
        
        <div className="p-8 max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button 
              onClick={() => onSelect("")}
              className="p-6 border-2 border-dashed border-slate-200 rounded-2xl hover:border-emerald-500 hover:bg-emerald-50 transition-all text-left space-y-2 group"
            >
              <h3 className="font-bold text-lg group-hover:text-emerald-700">No Boat Needed</h3>
              <p className="text-xs text-slate-500">I will provide my own or sort it with the leader later.</p>
            </button>
            {boats.filter(b => b.status === "available").map(boat => (
              <button 
                key={boat.id}
                onClick={() => onSelect(boat.id)}
                className="p-6 border-2 border-slate-100 rounded-2xl hover:border-emerald-500 hover:bg-emerald-50 transition-all text-left space-y-2 group"
              >
                <div className="flex justify-between items-start">
                  <h3 className="font-bold text-lg group-hover:text-emerald-700">{boat.name}</h3>
                  <Badge variant="success" className="text-[10px]">{boat.type}</Badge>
                </div>
                <div className="text-xs text-slate-500 space-y-1">
                  <p>Weight: {boat.paddlerWeight}</p>
                  <p>Location: {boat.location}</p>
                </div>
              </button>
            ))}
          </div>
          {boats.length === 0 && (
            <div className="text-center py-12 space-y-4">
              <Info className="mx-auto text-slate-300 w-12 h-12" />
              <p className="text-slate-500 italic">No boats currently available in the containers. Please contact the Equipment Officer or proceed without a booking.</p>
            </div>
          )}
        </div>
        <div className="p-4 bg-slate-50 flex justify-end">
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </motion.div>
    </div>
  );
};

const Events = ({ filterType = "all" }: EventsProps) => {
  const { user, profile } = useAuth();
  const { confirm, alert } = useUI();
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [isBooking, setIsBooking] = useState(false);
  const [filter, setFilter] = useState(filterType);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const type = params.get("type");
    if (type) setFilter(type);
  }, []);

  useEffect(() => {
    const q = query(collection(db, "events"));
    return onSnapshot(q, (snapshot) => {
      let filtered = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ClubEvent));
      if (filter !== "all") {
        filtered = filtered.filter(e => e.type === filter);
      }
      setEvents(filtered);
      setLoading(false);
    }, (error) => {
      if (auth.currentUser) {
        handleFirestoreError(error, OperationType.GET, "events");
      }
    });
  }, [filter]);

  const [boatsForBooking, setBoatsForBooking] = useState<Boat[]>([]);
  const [selectedEventForBoat, setSelectedEventForBoat] = useState<ClubEvent | null>(null);

  useEffect(() => {
    // Only fetch if needed
    const unsub = onSnapshot(query(collection(db, "boats"), where("status", "==", "available")), (s) => {
      setBoatsForBooking(s.docs.map(d => ({ id: d.id, ...d.data() } as Boat)));
    }, (error) => {
      console.warn("[HireBoat] Boats listener fail:", error);
    });
    return () => unsub();
  }, []);

  const [selectedEventForBooking, setSelectedEventForBooking] = useState<ClubEvent | null>(null);
  const [bookingFormData, setBookingFormData] = useState({
    childCount: 0,
    couponCode: "",
    useChildCoupons: false
  });

  const calculateBookingPrice = (event: ClubEvent, childCount: number, useChildCoupons: boolean) => {
    if (event.type !== "pool") return 0;
    
    // Only Instructors skip payment for pool sessions
    const isImmune = profile?.role === "instructor";
    
    let basePrice = 0;
    if (!isImmune) {
      basePrice = isMember ? 10 : 12;
    }

    let childrenPrice = 0;
    if (!useChildCoupons) {
      childrenPrice = childCount * 5;
    }

    return basePrice + childrenPrice;
  };

  const handleBook = async (event: ClubEvent, selectedBoatId?: string) => {
    if (!user) return signIn();
    if (event.participants.includes(user.uid)) return;
    if (event.participants.length >= event.maxParticipants) return;

    if (event.type === "pool" && !selectedEventForBooking) {
      setSelectedEventForBooking(event);
      return;
    }

    if (event.allowBoatSelection && selectedBoatId === undefined) {
      setSelectedEventForBoat(event);
      return;
    }

    // Process Booking
    const isPool = event.type === "pool";
    const totalPrice = isPool ? calculateBookingPrice(event, bookingFormData.childCount, bookingFormData.useChildCoupons) : 0;
    
    // Check coupon code
    let finalPrice = totalPrice;
    let appliedCoupon: Coupon | null = null;
    let appliedCouponId: string | null = null;

    if (bookingFormData.couponCode) {
      try {
        const q = query(collection(db, "coupons"), where("code", "==", bookingFormData.couponCode.toUpperCase()));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const couponDoc = snap.docs[0];
          const coupon = couponDoc.data() as Coupon;
          
          if (coupon.used) {
            alert("This coupon code has already been used.");
            return;
          }

          appliedCoupon = coupon;
          appliedCouponId = couponDoc.id;

          if (coupon.type === "club" || coupon.type === "instructor") finalPrice = 0;
          else if (coupon.type === "custom") finalPrice = 0; // custom is free for now
          
          // Legacy support or fallback for old coupons
          else if (coupon.type === "one-time") finalPrice = 0;
          else if (coupon.type === "fixed") finalPrice = Math.max(0, finalPrice - (coupon.value || 0));
          else if (coupon.type === "percent") finalPrice = Math.max(0, finalPrice * (1 - (coupon.value || 0) / 100));
        } else if (bookingFormData.couponCode.toLowerCase() !== "instructor2024") {
          alert("Invalid coupon code.");
          return;
        } else {
          finalPrice = 0; // instructor2024 fallback
        }
      } catch (e) {
        console.error("Coupon check failed", e);
      }
    }

    setIsBooking(true);

    if (finalPrice > 0) {
      try {
        const response = await fetch("/api/create-checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "pool_session",
            userId: user.uid,
            userEmail: user.email,
            selectedPoolSessionId: event.id,
            amount: Math.round(finalPrice * 100),
            childCount: bookingFormData.childCount,
            useChildCoupons: bookingFormData.useChildCoupons
          }),
        });
        const data = await safeJson(response);
        if (!response.ok) throw new Error(data.error || "Payment failed");
        
        if (data.url) {
          openPaymentUrl(data.url);
          return;
        }
      } catch (e: any) {
        alert(e.message || "Failed to initiate payment.");
        setIsBooking(false);
        return;
      } finally {
        setIsBooking(false);
      }
    }

    try {
      const data: any = {
        participants: [...event.participants, user.uid]
      };
      if (selectedBoatId) data.boatId = selectedBoatId;
      
      // If used child coupons, decrement them
      if (bookingFormData.useChildCoupons && profile?.childCoupons) {
        await updateDoc(doc(db, "users", user.uid), {
          childCoupons: Math.max(0, (profile.childCoupons || 0) - bookingFormData.childCount)
        });
      }

      // Mark applied coupon as used
      if (appliedCouponId) {
        await updateDoc(doc(db, "coupons", appliedCouponId), {
          used: true,
          usedBy: user.uid,
          usedAt: serverTimestamp()
        });
      }
      
      await updateDoc(doc(db, "events", event.id), data);
      setSelectedEventForBoat(null);
      setSelectedEventForBooking(null);
      setBookingFormData({ childCount: 0, couponCode: "", useChildCoupons: false });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `events/${event.id}`);
    } finally {
      setIsBooking(false);
    }
  };

  const handleUnbook = async (event: ClubEvent) => {
    if (!user) return;
    confirm("Are you sure you want to cancel your booking?", async () => {
      try {
        await updateDoc(doc(db, "events", event.id), {
          participants: event.participants.filter(pid => pid !== user.uid)
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `events/${event.id}`);
      }
    });
  };

  const handleDuplicate = async (event: ClubEvent) => {
    confirm("Duplicate this event for next week?", async () => {
      const { id, ...rest } = event;
      const nextDate = new Date(event.date.toDate ? event.date.toDate() : event.date);
      nextDate.setDate(nextDate.getDate() + 7);
      
      try {
        await addDoc(collection(db, "events"), {
          ...rest,
          date: nextDate,
          participants: []
        });
        alert("Event duplicated successfully.");
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, "events");
      }
    });
  };

  const isMember = profile?.role === "member" || profile?.role === "leader" || profile?.role === "instructor" || profile?.role === "admin";
  const canManage = profile?.role === "leader" || profile?.role === "instructor" || profile?.role === "admin";

  return (
    <div className="space-y-8 py-8">
      <div className="flex justify-between items-end">
        <div className="space-y-2">
          <h2 className="text-3xl font-bold">Upcoming Events</h2>
          <p className="text-slate-600">Join our tours, sessions, and social meets.</p>
        </div>
        {canManage && (
          <Link to="/dashboard/leader">
            <Button variant="secondary"><Plus size={20} className="mr-2" /> Create Event</Button>
          </Link>
        )}
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {events.map(event => {
          const isBooked = user && event.participants.includes(user.uid);
          const isFull = event.participants.length >= event.maxParticipants;
          
          // Re-evaluate: isMember means full membership
          const isFullMember = profile?.role === "member" || profile?.role === "leader" || profile?.role === "instructor" || profile?.role === "admin";
          const isRecruit = ["beginner_paid", "pending_leader_approval", "trial_active", "pool_passed"].includes(profile?.onboardingStatus || "");
          
          // Recruits can book pool sessions (and any event if role allows, but recruits usually have 'future_member' role)
          const canBook = isFullMember || isRecruit || (event.type === "pool" && profile?.onboardingStatus === "none");
          
          const typeConfig: Record<string, { color: string, icon: any, label: string }> = {
            river: { color: "bg-blue-100 text-blue-700 border-blue-200", icon: <Waves size={16} />, label: "River Tour" },
            pool: { color: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: <Anchor size={16} />, label: "Pool Session" },
            social: { color: "bg-amber-100 text-amber-700 border-amber-200", icon: <Users size={16} />, label: "Social Meet" },
            training: { color: "bg-purple-100 text-purple-700 border-purple-200", icon: <Zap size={16} />, label: "Training" }
          };
          
          const config = typeConfig[event.type] || typeConfig.social;

          return (
            <Card key={event.id} className="flex flex-col group hover:shadow-md transition-all border-slate-200">
              <div className="p-6 space-y-4 flex-1">
                <div className="flex justify-between items-start">
                  <div className={cn("flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold border", config.color)}>
                    {config.icon}
                    {config.label}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-500 font-medium">
                      {format(new Date(event.date.toDate ? event.date.toDate() : event.date), "MMM d, h:mm a")}
                    </span>
                    {canManage && (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleDuplicate(event)} title="Duplicate for next week">
                          <Plus size={14} />
                        </Button>
                        <Link to={`/dashboard/leader?edit=${event.id}`}>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Edit Event">
                            <Edit size={14} />
                          </Button>
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
                <h3 className="text-xl font-bold text-slate-900">{event.title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed line-clamp-3">{event.description}</p>
                
                {event.boatId && <BoatBadge boatId={event.boatId} />}

                {event.location && (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <MapPin size={16} className="text-emerald-500" />
                    <span>{event.location}</span>
                  </div>
                )}

                {event.showMap && (event.location || event.locationAddress) && (
                  <div className="h-48 w-full rounded-xl overflow-hidden border border-slate-200 relative group/map">
                    <iframe 
                      width="100%" 
                      height="100%" 
                      frameBorder="0" 
                      style={{ border: 0 }}
                      src={`https://maps.google.com/maps?q=${encodeURIComponent(event.locationAddress || event.location || "")}&t=&z=13&ie=UTF8&iwloc=&output=embed`}
                      allowFullScreen
                      referrerPolicy="no-referrer"
                    ></iframe>
                    <div className="absolute bottom-2 right-2 opacity-0 group-hover/map:opacity-100 transition-opacity">
                      <a 
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.locationAddress || event.location || "")}`} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-lg text-xs font-bold text-slate-900 shadow-sm border border-slate-200 flex items-center gap-1 hover:bg-white"
                      >
                        <MapPin size={12} /> Open in Maps
                      </a>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Users size={16} />
                  <div className="flex items-center">
                    <span>{event.participants.length} / {event.maxParticipants} participants</span>
                    {event.type === "pool" && <PoolNewRecruitIndicator participants={event.participants} />}
                  </div>
                </div>

                {event.participants.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
                    <div className="flex justify-between items-center">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Who's Coming</p>
                      {event.allowEventCoupon && (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-amber-50 border border-amber-100 rounded-md">
                          <Ticket size={10} className="text-amber-600" />
                          <span className="text-[10px] font-bold text-amber-900 font-mono">INSTRUCTOR2024</span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {event.participants.map(pid => (
                        <div key={pid} className="group relative">
                          <ParticipantBadge uid={pid} />
                          {canManage && (
                            <button 
                              onClick={() => {
                                confirm(`Remove participant?`, async () => {
                                  try {
                                    await updateDoc(doc(db, "events", event.id), {
                                      participants: event.participants.filter(p => p !== pid)
                                    });
                                  } catch (e) {
                                    handleFirestoreError(e, OperationType.UPDATE, `events/${event.id}`);
                                  }
                                });
                              }}
                              className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X size={8} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="p-4 bg-slate-50 border-t border-slate-100">
                {isBooked ? (
                  <Button variant="outline" className="w-full text-red-600 hover:bg-red-50 hover:border-red-200" onClick={() => handleUnbook(event)}>
                    <X size={18} className="mr-2" /> Cancel Booking
                  </Button>
                ) : isFull ? (
                  <Button variant="outline" className="w-full" disabled>Full</Button>
                ) : canBook ? (
                  <Button onClick={() => handleBook(event)} className="w-full">Book Now</Button>
                ) : !user ? (
                  <div className="space-y-3">
                    <p className="text-xs text-center text-slate-500 italic">Only Members can book.</p>
                    <Link to="/onboarding" className="block">
                      <Button variant="secondary" size="sm" className="w-full">Join the Club</Button>
                    </Link>
                  </div>
                ) : (
                  <p className="text-xs text-center text-slate-500 italic">Membership required for this event</p>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      <BoatSelectionModal 
        isOpen={!!selectedEventForBoat} 
        onClose={() => setSelectedEventForBoat(null)} 
        onSelect={(boatId) => selectedEventForBoat && handleBook(selectedEventForBoat, boatId)} 
        boats={boatsForBooking} 
      />
      <PoolBookingModal 
        isOpen={!!selectedEventForBooking}
        onClose={() => setSelectedEventForBooking(null)}
        onConfirm={() => selectedEventForBooking && handleBook(selectedEventForBooking)}
        event={selectedEventForBooking}
        profile={profile}
        formData={bookingFormData}
        setFormData={setBookingFormData}
        isMember={isMember}
      />
    </div>
  );
};

const PartnerClubsRegistry = () => {
  const [registeredClubs, setRegisteredClubs] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingClub, setEditingClub] = useState<UserProfile | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [isPromoting, setIsPromoting] = useState(false);

  useEffect(() => {
    const unsubClubs = onSnapshot(query(collection(db, "users"), where("role", "==", "partner_club")), (s) => {
      setRegisteredClubs(s.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile)));
      setLoading(false);
    });

    const unsubAll = onSnapshot(collection(db, "users"), (s) => {
      setAllUsers(s.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile)));
    });

    return () => { unsubClubs(); unsubAll(); };
  }, []);

  const handlePromote = async (user: UserProfile) => {
    setIsPromoting(true);
    try {
      await updateDoc(doc(db, "users", user.uid), {
        role: "partner_club",
        displayName: user.displayName || `${user.firstName} ${user.lastName}`,
        clubAdultPrice: 10,
        clubChildPrice: 5
      });
      alert(`User ${user.email} promoted to Partner Club successfully.`);
    } catch (e: any) {
      alert("Failed to promote: " + e.message);
    } finally {
      setIsPromoting(false);
    }
  };

  const handleUpdateClub = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingClub) return;
    const formData = new FormData(e.currentTarget);
    try {
      await updateDoc(doc(db, "users", editingClub.uid), {
        displayName: formData.get("displayName"),
        clubWebsite: formData.get("clubWebsite"),
        clubAdultPrice: Number(formData.get("clubAdultPrice")),
        clubChildPrice: Number(formData.get("clubChildPrice")),
        clubPhone: formData.get("clubPhone"),
        clubDescription: formData.get("clubDescription"),
      });
      setEditingClub(null);
      alert("Club details and custom pricing updated.");
    } catch (e) {
      alert("Failed to update club.");
    }
  };

  const filteredUsers = searchTerm.length > 2 
    ? allUsers.filter(u => u.role !== "partner_club" && (u.email?.toLowerCase().includes(searchTerm.toLowerCase()) || u.displayName?.toLowerCase().includes(searchTerm.toLowerCase())))
    : [];

  return (
    <Card className="p-8 space-y-8 border-none shadow-xl shadow-slate-200/50">
      <div className="flex justify-between items-center border-b pb-6 text-left">
        <div>
          <h3 className="text-2xl font-black italic flex items-center gap-3 text-slate-900">
            <Anchor size={28} className="text-emerald-600" />
            Partner Club Management
          </h3>
          <p className="text-slate-400 text-sm font-medium mt-1 uppercase tracking-widest">Configure access and custom pricing</p>
        </div>
      </div>

      <div className="space-y-4 text-left bg-slate-50 p-6 rounded-[2rem] border border-slate-100/50">
        <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
          <Plus size={14} className="text-emerald-600" /> Manually Create / Promote a Partner
        </h4>
        <div className="relative">
          <input 
            className="w-full h-12 pl-12 pr-4 border rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all shadow-sm"
            placeholder="Search users by email or name to promote..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
        </div>
        {filteredUsers.length > 0 && (
          <div className="bg-white border rounded-2xl overflow-hidden shadow-xl mt-2 animate-in fade-in slide-in-from-top-2">
            {filteredUsers.map(u => (
              <div key={u.uid} className="p-4 flex items-center justify-between hover:bg-slate-50 border-b last:border-0 border-slate-100">
                <div>
                  <p className="font-bold text-slate-900">{u.displayName || `${u.firstName} ${u.lastName}`}</p>
                  <p className="text-xs text-slate-500">{u.email} ({u.role || "No Role"})</p>
                </div>
                <Button 
                  size="sm" 
                  disabled={isPromoting}
                  className="bg-emerald-600 hover:bg-emerald-700 h-9 rounded-xl px-4"
                  onClick={() => handlePromote(u)}
                >
                  <Zap size={14} className="mr-2" /> Make Partner
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {editingClub && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[150] flex items-center justify-center p-4">
          <Card className="w-full max-w-lg p-8 animate-in zoom-in-95 duration-200 text-left">
            <h2 className="text-2xl font-black mb-6 italic text-slate-900 border-b pb-4">Edit <span className="text-emerald-600">{editingClub.displayName}</span></h2>
            <form onSubmit={handleUpdateClub} className="space-y-4 py-4">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 block">Club Name</label>
                <input name="displayName" defaultValue={editingClub.displayName} className="w-full p-3 border rounded-xl" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 block">Website</label>
                  <input name="clubWebsite" defaultValue={editingClub.clubWebsite} className="w-full p-3 border rounded-xl" />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 block">Phone</label>
                  <input name="clubPhone" defaultValue={editingClub.clubPhone || ""} className="w-full p-3 border rounded-xl" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 block">Description</label>
                <textarea name="clubDescription" defaultValue={editingClub.clubDescription || ""} rows={3} className="w-full p-3 border rounded-xl" />
              </div>
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-emerald-600 mb-1 block">Adult Price (£)</label>
                  <input name="clubAdultPrice" type="number" defaultValue={editingClub.clubAdultPrice || 10} className="w-full p-3 border-emerald-100 bg-emerald-50/30 rounded-xl font-bold" />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-emerald-600 mb-1 block">Child Price (£)</label>
                  <input name="clubChildPrice" type="number" defaultValue={editingClub.clubChildPrice || 5} className="w-full p-3 border-emerald-100 bg-emerald-50/30 rounded-xl font-bold" />
                </div>
              </div>
              <div className="flex gap-3 pt-6">
                <Button type="button" variant="outline" className="flex-1 h-14 font-black italic rounded-2xl" onClick={() => setEditingClub(null)}>Cancel</Button>
                <Button type="submit" className="flex-1 h-14 bg-emerald-600 hover:bg-emerald-700 font-black italic rounded-2xl shadow-xl shadow-emerald-100">Save Changes</Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      <div className="space-y-8 text-left">
        <div>
          <h4 className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
            <CheckCircle2 size={12} /> 
            Active Partner Accounts ({registeredClubs.length})
          </h4>
          {loading ? (
             <div className="animate-pulse space-y-4">
                <div className="h-24 bg-slate-50 rounded-3xl" />
                <div className="h-24 bg-slate-50 rounded-3xl" />
             </div>
          ) : registeredClubs.length === 0 ? (
            <p className="text-center py-20 border-2 border-dashed border-slate-100 rounded-[2.5rem] text-slate-400 text-sm italic">No partner clubs have registered their accounts yet.</p>
          ) : (
            <div className="grid gap-4">
              {registeredClubs.map(club => (
                <div key={club.uid} className="p-6 bg-white rounded-[2rem] flex flex-col md:flex-row justify-between items-start md:items-center border border-slate-100 hover:shadow-2xl hover:border-emerald-200 transition-all group">
                  <div className="flex items-center gap-5">
                    <div className="w-16 h-16 bg-slate-50 text-slate-400 rounded-2xl flex items-center justify-center font-black text-2xl shadow-sm group-hover:scale-110 group-hover:bg-emerald-600 group-hover:text-white transition-all duration-500">
                      {club.displayName?.[0] || club.email?.[0]}
                    </div>
                    <div>
                      <p className="font-black text-slate-900 text-xl italic leading-none">{club.displayName}</p>
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">{club.email}</p>
                      <div className="flex gap-3 mt-3">
                        <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-100 uppercase tracking-widest">Adult £{club.clubAdultPrice || 10}</span>
                        <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-100 uppercase tracking-widest">Child £{club.clubChildPrice || 5}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-6 md:mt-0 w-full md:w-auto">
                    <Button 
                      variant="outline" 
                      className="flex-1 md:flex-none h-14 rounded-2xl px-8 font-black italic hover:bg-slate-50 transition-all"
                      onClick={() => setEditingClub(club)}
                    >
                      Management
                    </Button>
                    <Link to="/dashboard/financial" className="flex-1 md:flex-none">
                      <Button className="w-full h-14 rounded-2xl px-8 bg-slate-900 text-white font-black italic shadow-lg hover:bg-slate-800 transition-all">
                        Financials
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};

const CouponManager = () => {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, "coupons"), orderBy("code")), (s) => {
      setCoupons(s.docs.map(d => ({ id: d.id, ...d.data() } as Coupon)));
      setLoading(false);
    }, (error) => {
      console.warn("[CouponManager] Coupons fail:", error);
      setLoading(false);
    });
    const unsubEvents = onSnapshot(query(collection(db, "events"), where("type", "==", "pool")), (s) => {
      setEvents(s.docs.map(d => ({ id: d.id, ...d.data() } as ClubEvent)));
    }, (error) => {
      console.warn("[CouponManager] Events fail:", error);
    });
    return () => { unsub(); unsubEvents(); };
  }, []);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    try {
      await addDoc(collection(db, "coupons"), {
        code: (formData.get("code") as string).toUpperCase(),
        type: formData.get("type"),
        value: Number(formData.get("value")),
        description: formData.get("description"),
        eventId: formData.get("eventId") || null,
        usedBy: [],
        createdAt: serverTimestamp()
      });
      setShowCreate(false);
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, "coupons");
    }
  };

  return (
    <Card className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-bold flex items-center gap-2">
          <Ticket size={24} className="text-emerald-600" />
          Coupon Generator
        </h3>
        <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? "Cancel" : "Create Coupon"}
        </Button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="p-4 bg-slate-50 rounded-xl space-y-4 border border-emerald-100 shadow-inner">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Unique Code</label>
              <input name="code" required placeholder="E.G. POOLFREE" className="w-full p-2 border rounded-lg bg-white font-mono" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Value Type</label>
              <select name="type" className="w-full p-2 border rounded-lg bg-white">
                <option value="one-time">One-time Use (Full Bypass)</option>
                <option value="fixed">Fixed Discount (£)</option>
                <option value="percent">Percentage (%)</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Value</label>
              <input name="value" type="number" required defaultValue="0" className="w-full p-2 border rounded-lg bg-white" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Restrict to Event (Optional)</label>
              <select name="eventId" className="w-full p-2 border rounded-lg bg-white">
                <option value="">Any Event</option>
                {events.map(e => (
                  <option key={e.id} value={e.id}>{e.title} ({format(new Date(e.date.toDate ? e.date.toDate() : e.date), "MMM d")})</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Description</label>
            <input name="description" placeholder="Who is this for?" className="w-full p-2 border rounded-lg bg-white" />
          </div>
          <Button type="submit" className="w-full shadow-lg shadow-emerald-100">Generate Coupon Code</Button>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-black">
            <tr>
              <th className="p-3">Code</th>
              <th className="p-3">Type</th>
              <th className="p-3">Value</th>
              <th className="p-3">Usage</th>
              <th className="p-3">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {coupons.map(c => (
              <tr key={c.id}>
                <td className="p-3 font-mono font-bold text-emerald-600">{c.code}</td>
                <td className="p-3">{c.type}</td>
                <td className="p-3">{c.type === 'percent' ? `${c.value}%` : `£${c.value}`}</td>
                <td className="p-3">{c.usedBy?.length || 0} uses</td>
                <td className="p-3">
                  <button onClick={() => {
                    const confirmDel = window.confirm("Delete coupon?");
                    if (confirmDel) deleteDoc(doc(db, "coupons", c.id));
                  }} className="text-red-500 hover:text-red-700">
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {coupons.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-slate-400 italic">No coupons generated yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

const PartnerRegistrationModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
  const { user, profile } = useAuth();
  const { alert } = useUI();
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    clubName: "",
    clubWebsite: "",
    mobile: "",
    clubDescription: ""
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill from profile if available
  useEffect(() => {
    if (profile) {
      setFormData(prev => ({
        ...prev,
        firstName: profile.firstName || "",
        lastName: profile.lastName || ""
      }));
    }
  }, [profile]);

  if (!isOpen || !user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const userRef = doc(db, "users", user.uid);
      console.log("[PartnerRegistration] Updating profile to partner role...");
      await setDoc(userRef, {
        role: "partner_club",
        displayName: formData.clubName,
        partnerFirstName: formData.firstName,
        partnerLastName: formData.lastName,
        clubWebsite: formData.clubWebsite,
        clubPhone: formData.mobile,
        clubDescription: formData.clubDescription,
        clubAdultPrice: 10,
        clubChildPrice: 5,
        createdAt: serverTimestamp(), 
        updatedAt: serverTimestamp()
      }, { merge: true });

      // Trigger Welcome Email from Server (Non-blocking ideally, but we await to confirm)
      console.log("[PartnerRegistration] Profile updated. Triggering welcome email for:", user.email);
      try {
        const emailResponse = await fetch("/api/partner/welcome", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: user.email,
            firstName: formData.firstName,
            clubName: formData.clubName
          })
        });
        if (!emailResponse.ok) {
           const errText = await emailResponse.text();
           console.warn("[PartnerRegistration] Email trigger non-OK response:", emailResponse.status, errText);
        }
      } catch (emailErr) {
        console.warn("[PartnerRegistration] Email trigger fatal error:", emailErr);
      }

      alert("Registration successful! Welcome to the Partner Program.");
      onClose();
      // Safe navigation with a slight delay to ensure state updates if any
      setTimeout(() => {
        window.location.href = "/dashboard/club";
      }, 500);
    } catch (e: any) {
      console.error("[PartnerRegistration Error]", e);
      setError("Update failed: " + (e.message || "Unknown error"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[150] flex items-center justify-center p-4">
      <Card className="w-full max-w-lg p-8 animate-in zoom-in-95 duration-200 text-left">
        <h2 className="text-3xl font-black mb-6 italic">Partner Club <span className="text-emerald-600">Details</span></h2>
        
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-600 rounded-xl flex items-center gap-3">
            <AlertCircle size={20} />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1 block">Responsible First Name</label>
              <input 
                required
                className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                value={formData.firstName}
                onChange={(e) => setFormData({...formData, firstName: e.target.value})}
                placeholder="Name"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1 block">Surname</label>
              <input 
                required
                className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                value={formData.lastName}
                onChange={(e) => setFormData({...formData, lastName: e.target.value})}
                placeholder="Surname"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1 block">Official Club Name</label>
            <input 
              required
              className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
              value={formData.clubName}
              onChange={(e) => setFormData({...formData, clubName: e.target.value})}
              placeholder="e.g. Phoenix Kayak Club"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1 block">Website</label>
              <input 
                className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                value={formData.clubWebsite}
                onChange={(e) => setFormData({...formData, clubWebsite: e.target.value})}
                placeholder="https://..."
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1 block">Mobile Phone</label>
              <input 
                required
                className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                value={formData.mobile}
                onChange={(e) => setFormData({...formData, mobile: e.target.value})}
                placeholder="07..."
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1 block">Brief Description</label>
            <textarea 
              required
              rows={3}
              className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
              value={formData.clubDescription}
              onChange={(e) => setFormData({...formData, clubDescription: e.target.value})}
              placeholder="Tell us about your club..."
            />
          </div>
          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" className="flex-1 h-12" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting} className="flex-1 h-12 bg-emerald-600 hover:bg-emerald-700 shadow-xl shadow-emerald-100">
              {isSubmitting ? "Processing..." : "Complete Registration"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};

const BecomePartner = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { alert } = useUI();
  const [showRegModal, setShowRegModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pageContent, setPageContent] = useState({
    title: "Become a Partner Club",
    subtitle: "Open up new opportunities for your members and join our thriving kayaking community.",
    partnershipText: "Putney Bridge Canoe Club has an exclusive agreement with Phoenix Fitness Centre Swimming Pool. Every Wednesday evening, the pool is reserved exclusively for kayakers.",
    equipmentText: "Other clubs are welcome to join by inviting their members or actively coaching. We provide all necessary equipment, but clubs are welcome to bring their own."
  });
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "settings", "partner_page"), (s) => {
      if (s.exists()) setPageContent(s.data() as any);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (user && profile) {
      if (profile.role !== "partner_club" && profile.role !== "admin") {
        setShowRegModal(true);
      } else {
        setShowRegModal(false);
      }
    }
  }, [user, profile]);

  const handleAction = async () => {
    if (!user) {
      try {
        await signIn();
        // After sign in, the component re-renders. 
        // We'll use the profile check in re-render to potentially show modal.
      } catch (e) {
        console.error(e);
        alert("Sign in failed.");
      }
      return;
    }

    if (profile?.role === "partner_club") {
      navigate("/dashboard/club");
      return;
    }

    setShowRegModal(true);
  };

  const handleSavePageContent = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    try {
      await setDoc(doc(db, "settings", "partner_page"), {
        title: formData.get("title"),
        subtitle: formData.get("subtitle"),
        partnershipText: formData.get("partnershipText"),
        equipmentText: formData.get("equipmentText"),
      });
      setIsEditing(false);
      alert("Page content updated.");
    } catch (e) {
      alert("Failed to update content.");
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-16 px-4 space-y-12">
        <PartnerRegistrationModal isOpen={showRegModal} onClose={() => {
        if (!isSubmitting) setShowRegModal(false);
      }} />
      
      {profile?.role === "admin" && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setIsEditing(!isEditing)}>
            {isEditing ? "Cancel Editing" : "Edit Page Text"}
          </Button>
        </div>
      )}

      {isEditing ? (
        <form onSubmit={handleSavePageContent} className="space-y-6 bg-slate-50 p-8 rounded-3xl border-2 border-dashed border-slate-200">
          <div className="space-y-4">
            <input name="title" defaultValue={pageContent.title} className="w-full p-4 border rounded-xl font-bold" placeholder="Title" />
            <textarea name="subtitle" defaultValue={pageContent.subtitle} rows={2} className="w-full p-4 border rounded-xl" placeholder="Subtitle" />
            <textarea name="partnershipText" defaultValue={pageContent.partnershipText} rows={4} className="w-full p-4 border rounded-xl" placeholder="Partnership Details" />
            <textarea name="equipmentText" defaultValue={pageContent.equipmentText} rows={3} className="w-full p-4 border rounded-xl" placeholder="Equipment Details" />
          </div>
          <Button type="submit" className="w-full">Save Page Content</Button>
        </form>
      ) : (
        <>
          <div className="text-center space-y-4 animate-in slide-in-from-top-4 duration-500">
            <h1 className="text-5xl md:text-6xl font-black tracking-tight text-slate-900 italic">
              {pageContent.title.split(" ").map((word, i) => (
                <span key={i} className={word.toLowerCase() === "partner" ? "text-emerald-600 underline decoration-wavy decoration-emerald-200 mx-2" : "mx-1"}>
                  {word}
                </span>
              ))}
            </h1>
            <p className="text-xl text-slate-500 max-w-2xl mx-auto leading-relaxed">
              {pageContent.subtitle}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-8 items-stretch">
            <Card className="p-10 border-none bg-slate-50 shadow-none space-y-6 text-left">
              <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-100">
                <Waves size={28} />
              </div>
              <h3 className="text-2xl font-black italic">The Partnership</h3>
              <p className="text-slate-600 leading-relaxed">
                {pageContent.partnershipText}
              </p>
              <p className="text-slate-600 leading-relaxed font-medium">
                {pageContent.equipmentText}
              </p>
            </Card>

            <Card className="p-10 border-none bg-emerald-900 text-white shadow-2xl shadow-emerald-200/20 space-y-8 flex flex-col justify-between">
              <div className="space-y-6">
                <h3 className="text-3xl font-black italic">Ready to Join?</h3>
                <ul className="space-y-4 text-emerald-100 text-lg">
                  <li className="flex items-center gap-3"><Check size={20} className="text-emerald-400" /> Purchase batch assessment codes</li>
                  <li className="flex items-center gap-3"><Check size={20} className="text-emerald-400" /> Use pool facilities for your team</li>
                  <li className="flex items-center gap-3"><Check size={20} className="text-emerald-400" /> Manage members via our portal</li>
                </ul>
              </div>
              <div className="space-y-4">
                <Button 
                  className="w-full h-16 bg-emerald-500 hover:bg-emerald-400 text-white font-black text-xl rounded-2xl shadow-2xl shadow-emerald-950/40 transition-all active:scale-95"
                  onClick={handleAction}
                >
                  {profile?.role === "partner_club" ? "Go to Dashboard" : user ? "Register My Club" : "Sign in to Register"}
                </Button>
                <p className="text-center text-[10px] text-emerald-400 uppercase font-black tracking-[0.2em]">
                  Instant access after registration
                </p>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
};

const PartnerClubDashboard = () => {
  const { user, profile } = useAuth();
  const { confirm, alert } = useUI();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [adultCount, setAdultCount] = useState(0);
  const [childCount, setChildCount] = useState(0);
  const [isPurchasing, setIsPurchasing] = useState(false);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "coupons"), 
      where("ownerId", "==", user.uid),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(q, (s) => {
      setCoupons(s.docs.map(d => ({ id: d.id, ...d.data() } as Coupon)));
      setLoading(false);
    }, (error) => {
      console.warn("[PartnerClubDashboard] Coupons fail:", error);
      setLoading(false);
    });
    return () => unsub();
  }, [user]);

  const handleBuy = async (type: "club" | "child", count: number) => {
    if (!user || count <= 0) return;
    setIsPurchasing(true);
    try {
      const response = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "club_coupons",
          couponType: type,
          userId: user.uid,
          userEmail: user.email,
          couponCount: count
        }),
      });
      const data = await safeJson(response);
      if (data.url) window.location.href = data.url;
    } catch (e) {
      alert("Failed to initiate purchase.");
      setIsPurchasing(false);
    }
  };

  const handleManualRequest = (type: "club" | "child", count: number) => {
    if (count <= 0) return;
    confirm(`Request ${count} ${type === "child" ? "Child" : "Adult"} codes via Manual Transfer?`, () => {
      alert("Request sent. Our Finance team will contact you with bank details.");
    });
  };

  const availableCoupons = coupons.filter(c => !c.used);
  const usedCoupons = coupons.filter(c => c.used);
  
  const adultPrice = profile?.clubAdultPrice || 10;
  const childPrice = profile?.clubChildPrice || 5;

  const [activePortalTab, setActivePortalTab] = useState<"available" | "used">("available");

  const handleEmailCodes = async () => {
    if (availableCoupons.length === 0) return;
    try {
      const response = await fetch("/api/partner/email-coupons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user?.email,
          codes: availableCoupons.map(c => c.code),
          clubName: profile?.displayName || "Partner Club"
        })
      });
      if (response.ok) {
        alert("Codes sent to your email!");
      } else {
        throw new Error("Failed to send email");
      }
    } catch (e) {
      alert("Error sending codes email.");
    }
  };

  const handleDownload = () => {
    const data = availableCoupons.map(c => ({
      code: c.code,
      type: c.type,
      issued: c.createdAt ? (c.createdAt.toDate ? c.createdAt.toDate().toLocaleDateString() : new Date(c.createdAt).toLocaleDateString()) : "N/A"
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pbcc_codes_${profile?.displayName?.replace(/\s+/g, '_') || 'club'}.json`;
    a.click();
  };

  return (
    <div className="space-y-8 py-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-4xl font-black tracking-tight text-slate-900 italic">Partner <span className="text-emerald-600">Portal</span></h1>
          <p className="text-slate-500 text-sm font-medium">Club: {profile?.displayName || "Loading..."}</p>
        </div>
        <div className="flex bg-slate-100 p-1 rounded-xl">
          <button 
            onClick={() => setActivePortalTab("available")}
            className={cn("px-4 py-2 rounded-lg font-bold transition-all text-xs", activePortalTab === "available" ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500")}
          >
            Available ({availableCoupons.length})
          </button>
          <button 
            onClick={() => setActivePortalTab("used")}
            className={cn("px-4 py-2 rounded-lg font-bold transition-all text-xs", activePortalTab === "used" ? "bg-white text-slate-500 shadow-sm" : "text-slate-400")}
          >
            Used ({usedCoupons.length})
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-0 overflow-hidden shadow-xl shadow-slate-200/50 text-left border-none">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white/80 backdrop-blur">
              <h2 className="text-xl font-black italic flex items-center gap-2">
                <Ticket className="text-emerald-600" size={24} /> {activePortalTab === "available" ? "Active Codes" : "History"}
              </h2>
              {activePortalTab === "available" && availableCoupons.length > 0 && (
                <div className="flex gap-2">
                  <Button onClick={handleEmailCodes} variant="outline" size="sm" className="h-8 text-[10px] uppercase tracking-widest font-black border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-100">
                    <Mail size={14} className="mr-2" /> Email Me Codes
                  </Button>
                  <Button onClick={handleDownload} variant="outline" size="sm" className="h-8 text-[10px] uppercase tracking-widest font-black border-slate-100 text-slate-400 hover:bg-slate-50">
                    <Download size={14} className="mr-2" /> JSON
                  </Button>
                </div>
              )}
            </div>
            <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto bg-white/50">
              {loading ? (
                Array(3).fill(0).map((_, i) => (
                  <div key={i} className="p-6 animate-pulse flex justify-between items-center">
                    <div className="h-4 w-32 bg-slate-100 rounded" />
                    <div className="h-4 w-20 bg-slate-100 rounded" />
                  </div>
                ))
              ) : (activePortalTab === "available" ? availableCoupons : usedCoupons).length === 0 ? (
                <div className="p-16 text-center text-slate-400 italic">
                  {activePortalTab === "available" ? "No codes available. Purchase a batch below." : "No used codes found."}
                </div>
              ) : (
                (activePortalTab === "available" ? availableCoupons : usedCoupons).map(coupon => (
                  <div key={coupon.id} className={cn("p-6 flex justify-between items-center transition-colors group", coupon.used ? "opacity-50" : "hover:bg-white")}>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-3">
                        <span className={cn("font-mono text-2xl font-black tracking-widest", coupon.used ? "text-slate-400 line-through" : "text-slate-900")}>
                          {coupon.code}
                        </span>
                        <span className="px-2 py-1 bg-slate-100 text-slate-500 text-[9px] font-black rounded uppercase tracking-widest">
                          {coupon.type === "child" ? "CHILD" : "ADULT"}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">
                        {coupon.used ? (
                          `Used by ${coupon.usedBy?.substring(0,8)}... on ${coupon.usedAt ? format(coupon.usedAt.toDate ? coupon.usedAt.toDate() : new Date(coupon.usedAt), "dd MMM yyyy") : "?"}`
                        ) : (
                          `Issued ${coupon.createdAt ? format(coupon.createdAt.toDate ? coupon.createdAt.toDate() : new Date(coupon.createdAt), "dd MMM yyyy") : "Pre-paid"}`
                        )}
                      </span>
                    </div>
                    {!coupon.used && (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="border-slate-200 text-slate-600 h-10 px-6 rounded-xl group-hover:bg-emerald-600 group-hover:border-emerald-600 group-hover:text-white transition-all shadow-sm"
                        onClick={() => {
                          navigator.clipboard.writeText(coupon.code);
                          alert("Code copied!");
                        }}
                      >
                        Copy
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-8 border-none bg-emerald-50/40 text-left shadow-lg shadow-emerald-100/20">
            <h3 className="text-xl font-black mb-6 italic flex items-center gap-2">
              <Zap className="text-emerald-600" size={24} /> Buy Assessment Codes
            </h3>
            
            <div className="space-y-8">
              <div className="space-y-4">
                <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-emerald-100 shadow-sm">
                  <div>
                    <p className="text-sm font-black text-slate-900">Adult Batch</p>
                    <p className="text-[10px] font-bold text-slate-400 tracking-widest uppercase">£{adultPrice} ea</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => setAdultCount(Math.max(0, adultCount - 5))}
                      className="w-10 h-10 rounded-xl bg-slate-50 text-slate-400 hover:bg-slate-100 flex items-center justify-center font-black"
                    >-</button>
                    <span className="w-8 text-center font-black text-lg">{adultCount}</span>
                    <button 
                      onClick={() => setAdultCount(adultCount + 5)}
                      className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 hover:bg-emerald-200 flex items-center justify-center font-black"
                    >+</button>
                  </div>
                </div>

                <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-emerald-100 shadow-sm">
                  <div>
                    <p className="text-sm font-black text-slate-900">Child Batch</p>
                    <p className="text-[10px] font-bold text-slate-400 tracking-widest uppercase">£{childPrice} ea</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => setChildCount(Math.max(0, childCount - 5))}
                      className="w-10 h-10 rounded-xl bg-slate-50 text-slate-400 hover:bg-slate-100 flex items-center justify-center font-black"
                    >-</button>
                    <span className="w-8 text-center font-black text-lg">{childCount}</span>
                    <button 
                      onClick={() => setChildCount(childCount + 5)}
                      className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 hover:bg-emerald-200 flex items-center justify-center font-black"
                    >+</button>
                  </div>
                </div>
              </div>

              <div className="p-6 bg-emerald-900 text-white rounded-3xl space-y-4 shadow-xl shadow-emerald-900/10 border border-emerald-800">
                <div className="flex justify-between items-end border-b border-emerald-800 pb-4">
                  <p className="text-xs font-black uppercase tracking-widest text-emerald-400">Total Selection</p>
                  <p className="text-3xl font-black tabular-nums">£{ (adultCount * adultPrice) + (childCount * childPrice) }</p>
                </div>
                
                <div className="space-y-3 pt-2">
                  <Button 
                    disabled={isPurchasing || (adultCount === 0 && childCount === 0)}
                    onClick={async () => {
                      if (adultCount > 0) await handleBuy("club", adultCount);
                      if (childCount > 0) await handleBuy("child", childCount);
                    }}
                    className="w-full h-14 bg-emerald-500 hover:bg-emerald-400 text-white font-black rounded-2xl shadow-lg transition-all"
                  >
                    {isPurchasing ? "Connecting..." : "Pay via Stripe"}
                  </Button>
                  <button 
                    disabled={isPurchasing || (adultCount === 0 && childCount === 0)}
                    onClick={() => {
                      if (adultCount > 0) handleManualRequest("club", adultCount);
                      if (childCount > 0) handleManualRequest("child", childCount);
                    }}
                    className="w-full py-2 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400 hover:text-emerald-300 transition-colors"
                  >
                    Request Manual Transfer
                  </button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

const LeaderDashboard = () => {
  const { user, profile } = useAuth();
  const { allUsers, allBoats, visibility: globalVisibility } = useGlobal();
  const { confirm, alert } = useUI();
  const [searchParams, setSearchParams] = useSearchParams();
  const editId = searchParams.get("edit");
  const [pendingApprovals, setPendingApprovals] = useState<UserProfile[]>([]);
  const [savingNotesId, setSavingNotesId] = useState<string | null>(null);
  const [localNotes, setLocalNotes] = useState<Record<string, string>>({});
  const [instructors, setInstructors] = useState<UserProfile[]>([]);
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [rentals, setRentals] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ClubEvent | null>(null);
  const [approvalData, setApprovalData] = useState<{ uid: string, instructor: string, notes: string, paddlingLevel?: number } | null>(null);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"approvals" | "roster" | "events" | "skills" | "rentals" | "coupons" | "clubs">("approvals");

  const visibility = useMemo(() => {
    const role = profile?.role === "admin" ? "leader" : profile?.role;
    return globalVisibility[role || ""] || [];
  }, [globalVisibility, profile]);

  const members = useMemo(() => {
    return allUsers.filter(u => ["member", "leader", "admin", "instructor"].includes(u.role));
  }, [allUsers]);

  useEffect(() => {
    if (!user || !profile || (profile.role !== "leader" && profile.role !== "admin" && profile.role !== "instructor")) return;

    // Filter pending approvals and instructors from allUsers
    const pending = allUsers.filter(u => ["beginner_paid", "pending_leader_approval", "trial_active", "pro_pending_approval"].includes(u.onboardingStatus));
    setPendingApprovals(pending);
    
    // Sync local notes
    const notes: Record<string, string> = {};
    pending.forEach(u => {
      // Only set if we don't have a local unsaved draft
      notes[u.uid] = u.poolAssessmentNotes || "";
    });
    setLocalNotes(prev => {
      const merged = { ...notes };
      // Keep existing local changes that haven't been saved yet
      Object.keys(prev).forEach(id => {
        if (prev[id] !== undefined) merged[id] = prev[id];
      });
      return merged;
    });
    
    setInstructors(allUsers.filter(u => ["leader", "admin", "instructor"].includes(u.role)));

    let unsubEvents = () => {};
    let unsubRentals = () => {};

    if (db) {
      const qEvents = profile?.role === "admin" 
        ? query(collection(db, "events"))
        : query(collection(db, "events"), where("leaderId", "==", user.uid));
        
      unsubEvents = onSnapshot(qEvents, (snapshot) => {
        const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ClubEvent));
        setEvents(docs);
        if (editId) {
          const ev = docs.find(e => e.id === editId);
          if (ev) setEditingEvent(ev);
        }
      }, (error) => {
        if (auth.currentUser) handleFirestoreError(error, OperationType.GET, "events");
      });

      unsubRentals = onSnapshot(collection(db, "rentals"), (snapshot) => {
        setRentals(snapshot.docs.map(doc => doc.data()));
      }, (error) => handleFirestoreError(error, OperationType.GET, "rentals"));
    }

    return () => { unsubEvents(); unsubRentals(); };
  }, [user, profile, allUsers, editId]);

  const isVisible = (field: string) => profile?.role === "admin" || visibility.includes(field);

  const saveQuickNote = async (uid: string) => {
    setSavingNotesId(uid);
    try {
      if (db) {
        await updateDoc(doc(db, "users", uid), {
          poolAssessmentNotes: localNotes[uid] || "",
          updatedAt: serverTimestamp()
        });
        alert("Assessment note saved.");
      }
    } catch (error: any) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
    } finally {
      setSavingNotesId(null);
    }
  };

  const handleApprove = async (overrideAction?: "trial" | "membership") => {
    if (!approvalData) return;
    try {
      const userToApprove = allUsers.find(p => p.uid === approvalData.uid);
      const isPro = userToApprove?.onboardingStatus === "pro_pending_approval";
      const currentStatus = userToApprove?.onboardingStatus;

      // Update local notes before final save to ensure they are synced
      const finalNotes = localNotes[approvalData.uid] || approvalData.notes;

      // Logic Flow:
      // 1. beginner_paid -> pending_leader_approval (Assessed)
      // 2. pending_leader_approval -> trial_active (Issue Trial Coupon) OR pool_passed (Skip Trial)
      // 3. trial_active -> pool_passed (Invite to Join)

      if (currentStatus === "beginner_paid") {
        if (db) {
          await updateDoc(doc(db, "users", approvalData.uid), { 
            onboardingStatus: "pending_leader_approval" as OnboardingStatus,
            poolAssessmentNotes: finalNotes,
            poolAssessedBy: approvalData.instructor,
            paddlingLevel: approvalData.paddlingLevel || 1,
            assessmentDate: serverTimestamp()
          });
        }
        alert(`User ${userToApprove?.displayName} marked as assessed.`);
      } else if (currentStatus === "pending_leader_approval") {
        const nextStatus = overrideAction === "membership" ? "pool_passed" : "trial_active";
        if (db) {
          await updateDoc(doc(db, "users", approvalData.uid), { 
            onboardingStatus: nextStatus as OnboardingStatus,
            trialApprovedBy: approvalData.instructor,
            paddlingLevel: approvalData.paddlingLevel || 1,
            poolAssessmentNotes: finalNotes // Update notes here too if changed
          });
          
          if (nextStatus === "trial_active") {
            try {
              await fetch("/api/leader/issue-trial", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  userId: userToApprove?.uid,
                  userEmail: userToApprove?.email,
                  userName: userToApprove?.displayName,
                  instructorName: approvalData.instructor
                })
              });
            } catch (e) { console.error("Coupon error:", e); }
            alert(`Trial active for ${userToApprove?.displayName}. Coupon sent.`);
          } else {
            alert(`Skipped trial. ${userToApprove?.displayName} can now pay membership.`);
          }
        }
      } else if (currentStatus === "trial_active" || isPro) {
        if (db) {
          await updateDoc(doc(db, "users", approvalData.uid), { 
            onboardingStatus: "pool_passed" as OnboardingStatus,
            membershipApprovedBy: approvalData.instructor,
            paddlingLevel: approvalData.paddlingLevel || (isPro ? 2 : 1)
          });
        }
        alert(`Final membership invitation sent to ${userToApprove?.displayName}.`);
      }
      
      setApprovalData(null);
    } catch (error: any) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${approvalData.uid}`);
    }
  };

  const removeParticipant = async (eventId: string, currentParticipants: string[], participantId: string) => {
    confirm("Remove this participant from the event?", async () => {
      try {
        await updateDoc(doc(db, "events", eventId), {
          participants: currentParticipants.filter(p => p !== participantId)
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `events/${eventId}`);
      }
    });
  };

  const handleDuplicate = async (event: ClubEvent) => {
    const { id, ...rest } = event;
    const nextDate = new Date(event.date.toDate ? event.date.toDate() : event.date);
    nextDate.setDate(nextDate.getDate() + 7);
    
    try {
      await addDoc(collection(db, "events"), {
        ...rest,
        date: nextDate,
        participants: []
      });
      alert("Event duplicated for next week.");
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, "events");
    }
  };

  const createEvent = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const isRecurring = formData.get("recurring") === "on";
    const repeatWeeks = Number(formData.get("repeatWeeks")) || 1;
    
    try {
      const baseDate = new Date(formData.get("date") as string);
      const baseData = {
        title: formData.get("title") as string,
        description: formData.get("description") as string,
        type: formData.get("type") as any,
        leaderId: user?.uid,
        maxParticipants: Number(formData.get("maxParticipants")),
        location: formData.get("location") as string,
        locationAddress: formData.get("locationAddress") as string,
        showMap: formData.get("showMap") === "on",
        allowBoatSelection: formData.get("allowBoatSelection") === "on",
        allowEventCoupon: formData.get("allowEventCoupon") === "on",
        boatId: formData.get("boatId") as string || "",
      };

      if (editingEvent) {
        await updateDoc(doc(db, "events", editingEvent.id), {
          ...baseData,
          date: baseDate
        });
        setEditingEvent(null);
        setSearchParams({});
      } else {
        // Create multiple events if recurring
        const count = isRecurring ? repeatWeeks : 1;
        for (let i = 0; i < count; i++) {
          const eventDate = new Date(baseDate);
          eventDate.setDate(eventDate.getDate() + (i * 7));
          
          await addDoc(collection(db, "events"), {
            ...baseData,
            date: eventDate,
            participants: []
          });
        }
        setShowCreate(false);
      }
    } catch (error) {
      handleFirestoreError(error, editingEvent ? OperationType.UPDATE : OperationType.CREATE, "events");
    }
  };

  return (
    <div className="space-y-12 py-8">
      <div className="flex justify-between items-center">
        <div className="space-y-1">
          <h2 className="text-3xl font-bold">Leader Dashboard</h2>
          <p className="text-slate-500 text-sm">Manage events, approvals, and members.</p>
        </div>
        <div className="flex gap-4">
          <Link to="/directory">
            <Button variant="outline">
              <Users size={20} className="mr-2" /> Member Directory
            </Button>
          </Link>
          <Button onClick={() => {
            setShowCreate(!showCreate);
            setEditingEvent(null);
            setSearchParams({});
          }}>
            {showCreate || editingEvent ? "Cancel" : "Create New Event"}
          </Button>
        </div>
      </div>

      {(showCreate || editingEvent) && (
        <Card className="p-6 max-w-xl">
          <h3 className="text-xl font-bold mb-4">{editingEvent ? "Edit Event" : "Create New Event"}</h3>
          <form onSubmit={createEvent} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Title</label>
              <input name="title" required className="w-full p-2 border rounded-lg" defaultValue={editingEvent?.title} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <textarea name="description" required className="w-full p-2 border rounded-lg" defaultValue={editingEvent?.description} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Date & Time</label>
                <input name="date" type="datetime-local" required className="w-full p-2 border rounded-lg" defaultValue={editingEvent?.date ? format(new Date(editingEvent.date.toDate ? editingEvent.date.toDate() : editingEvent.date), "yyyy-MM-dd'T'HH:mm") : ""} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Type</label>
                <select name="type" required className="w-full p-2 border rounded-lg" defaultValue={editingEvent?.type}>
                  <option value="river">River Tour</option>
                  <option value="pool">Pool Session</option>
                  <option value="social">Social</option>
                  <option value="training">Training</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Location Name (e.g. Putney)</label>
                <input name="location" className="w-full p-2 border rounded-lg" defaultValue={editingEvent?.location} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Map Address (Full Address)</label>
                <input name="locationAddress" className="w-full p-2 border rounded-lg" defaultValue={editingEvent?.locationAddress} placeholder="e.g. Putney Embankment, London SW15 1LB" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Max Participants</label>
                <input name="maxParticipants" type="number" required className="w-full p-2 border rounded-lg" defaultValue={editingEvent?.maxParticipants} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Link a Boat (Optional)</label>
                <select name="boatId" className="w-full p-2 border rounded-lg" defaultValue={editingEvent?.boatId}>
                  <option value="">No Boat Linked</option>
                  {allBoats.map(b => (
                    <option key={b.id} value={b.id}>{b.name} ({b.type})</option>
                  ))}
                </select>
                <p className="text-[10px] text-amber-600 italic">"A boat booking does not guarantee availability and that the Leader can swap boats around at their discretion"</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-6 py-2">
              <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-slate-50 transition-colors">
                <input type="checkbox" name="showMap" defaultChecked={editingEvent?.showMap} className="w-4 h-4 text-emerald-600 rounded" />
                <span className="text-sm font-medium">Show Map</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-slate-50 transition-colors">
                <input type="checkbox" name="allowBoatSelection" defaultChecked={editingEvent?.allowBoatSelection} className="w-4 h-4 text-emerald-600 rounded" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">Allow Boat Selection</span>
                  <span className="text-[10px] text-slate-400 italic">Members can pick a boat during booking</span>
                </div>
              </label>

              <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-slate-50 transition-colors">
                <input type="checkbox" name="allowEventCoupon" defaultChecked={editingEvent?.allowEventCoupon} className="w-4 h-4 text-emerald-600 rounded" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">Allow Event Coupon</span>
                  <span className="text-[10px] text-slate-400 italic">Issue codes specifically for this event</span>
                </div>
              </label>

              {!editingEvent && (
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" name="recurring" className="w-4 h-4 text-emerald-600 rounded" />
                    <span className="text-sm font-medium">Recurring Weekly</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">for</span>
                    <input name="repeatWeeks" type="number" min="1" max="12" defaultValue="4" className="w-16 p-1 border rounded text-sm" />
                    <span className="text-xs text-slate-500">weeks</span>
                  </div>
                </div>
              )}
            </div>
            <Button type="submit" className="w-full">
              {editingEvent ? "Update Event" : "Create Event"}
            </Button>
          </form>
        </Card>
      )}

      <div className="flex border-b border-slate-200 overflow-x-auto gap-8 mb-8">
        {(["approvals", "events", "skills", "rentals", "coupons", "clubs"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "pb-4 text-sm font-bold uppercase tracking-widest transition-all border-b-2 px-1 whitespace-nowrap",
              activeTab === tab ? "border-emerald-600 text-emerald-600" : "border-transparent text-slate-400 hover:text-slate-600"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "approvals" && (
        <section className="space-y-4">
          <h3 className="text-xl font-bold flex items-center gap-2">
            <Users size={20} /> Pending Approvals
          </h3>
          <div className="grid md:grid-cols-2 gap-4">
            {pendingApprovals.length === 0 && <p className="text-slate-500 italic">No pending approvals.</p>}
            {pendingApprovals.map(m => (
              <Card key={m.uid} className="p-4 space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold">{m.displayName}</p>
                      {m.bookedSessionDate && (
                        <span className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded-full">
                          Booked: {format(new Date(m.bookedSessionDate.toDate ? m.bookedSessionDate.toDate() : m.bookedSessionDate), "MMM d")}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">{m.email}</p>
                    <div className="flex gap-2 items-center mt-1">
                      <Badge variant="warning">{m.onboardingStatus.replace("_", " ")}</Badge>
                      {m.paddlingLevel && <Badge variant="default" className="bg-blue-50 text-blue-600 border-blue-100 italic text-[9px]">Lvl {m.paddlingLevel}</Badge>}
                    </div>
                  </div>
                  <Button 
                    size="sm" 
                    variant={m.onboardingStatus === "trial_active" ? "primary" : m.onboardingStatus === "pending_leader_approval" ? "outline" : "secondary"}
                    onClick={() => setApprovalData({ uid: m.uid, instructor: "", notes: localNotes[m.uid] || "", paddlingLevel: m.paddlingLevel })}
                  >
                    {m.onboardingStatus === "pro_pending_approval" ? "Review & Approve" : 
                     m.onboardingStatus === "trial_active" ? "Invite to Join" :
                     m.onboardingStatus === "pending_leader_approval" ? "Approve Trial" :
                     "Mark Assessed"}
                  </Button>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Assessor Notes</label>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      className="h-6 text-[10px] text-emerald-600 hover:text-emerald-700 p-1"
                      onClick={() => saveQuickNote(m.uid)}
                      disabled={savingNotesId === m.uid}
                    >
                      {savingNotesId === m.uid ? <RefreshCw size={10} className="animate-spin mr-1" /> : <Check size={10} className="mr-1" />}
                      Save Note
                    </Button>
                  </div>
                  <textarea 
                    className="w-full p-2 text-xs border rounded-lg bg-slate-50 focus:bg-white transition-colors focus:ring-1 focus:ring-emerald-500 outline-none"
                    placeholder="Add observations about level, fitness, or focus areas..."
                    rows={2}
                    value={localNotes[m.uid] || ""}
                    onChange={(e) => setLocalNotes({ ...localNotes, [m.uid]: e.target.value })}
                  />
                </div>

                {m.onboardingStatus === "pro_pending_approval" && (
                  <div className="p-3 bg-slate-50 rounded-lg text-sm border">
                    <p className="font-medium">Experience Description:</p>
                    <p className="text-slate-600 italic mt-1">{m.paddlingDescription}</p>
                    <p className="mt-2 text-xs">Years: {m.yearsPaddling} | BC Member: {m.britishCanoeingMember ? "Yes" : "No"}</p>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </section>
      )}

      {activeTab === "events" && (
        <section className="space-y-4">
          <h3 className="text-xl font-bold flex items-center gap-2">
            <Calendar size={20} /> Your Managed Events
          </h3>
          <div className="grid md:grid-cols-2 gap-6">
            {events.length === 0 && <p className="text-slate-500 italic">No events managed by you.</p>}
            {events.map(e => (
              <Card key={e.id} className="overflow-hidden">
                <div className="p-4 cursor-pointer hover:bg-slate-50 transition-colors" onClick={() => setExpandedEventId(expandedEventId === e.id ? null : e.id)}>
                  <div className="flex justify-between items-center">
                    <div className="space-y-1">
                      <h4 className="font-bold">{e.title}</h4>
                      <p className="text-xs text-slate-500">{format(new Date(e.date.toDate ? e.date.toDate() : e.date), "PPP")}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={e.participants.length >= e.maxParticipants ? "warning" : "default"}>
                        {e.participants.length} / {e.maxParticipants}
                      </Badge>
                      {expandedEventId === e.id ? <ChevronUp size={20} className="text-slate-400" /> : <ChevronDown size={20} className="text-slate-400" />}
                    </div>
                  </div>
                </div>
                
                {expandedEventId === e.id && (
                  <div className="p-4 border-t bg-slate-50/50 space-y-4 animate-in slide-in-from-top-2 duration-200">
                    <div>
                      <h5 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Booked Participants</h5>
                      {e.participants.length === 0 ? (
                        <p className="text-xs text-slate-400 italic">No one has booked yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {e.participants.map(pid => {
                            const p = allUsers.find(m => m.uid === pid);
                            return (
                              <div key={pid} className="flex justify-between items-center p-2 bg-white rounded border border-slate-100 shadow-sm">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 text-xs font-bold">
                                    {p?.displayName ? p.displayName[0] : "?"}
                                  </div>
                                  <div>
                                    <p className={cn(
                                      "text-sm font-medium", 
                                      (["pending_leader_approval", "beginner_paid", "trial_active", "pool_passed"].includes(p?.onboardingStatus || "") || p?.paddlingLevel === 1) && "text-red-500 font-black",
                                      p?.paddlingLevel === 3 && "underline underline-offset-2 decoration-2"
                                    )}>
                                      {p?.displayName || "Unknown User"}
                                      {(["pending_leader_approval", "beginner_paid", "trial_active", "pool_passed"].includes(p?.onboardingStatus || "") || p?.paddlingLevel === 1) && <span className="ml-2 text-[8px] bg-red-100 text-red-600 px-1 py-0.5 rounded italic">NEW/BEGINNER</span>}
                                    </p>
                                    <p className="text-[10px] text-slate-400">{p?.email || "No email"}</p>
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <a href={`mailto:${p?.email}?subject=PBCC Event: ${e.title}`} className="p-1.5 text-slate-400 hover:text-emerald-600 transition-colors" title="Email Member">
                                    <Mail size={16} />
                                  </a>
                                  <button onClick={() => removeParticipant(e.id, e.participants, pid)} className="p-1.5 text-slate-400 hover:text-red-500 transition-colors" title="Remove Member">
                                    <UserMinus size={16} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 pt-2 border-t">
                      <Link to={`/dashboard/leader?edit=${e.id}`} className="flex-1">
                        <Button size="sm" variant="outline" className="w-full">Edit Event</Button>
                      </Link>
                      <Button size="sm" variant="outline" onClick={() => handleDuplicate(e)} className="flex-1">Duplicate</Button>
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </section>
      )}

      {activeTab === "skills" && (
        <Card className="p-6 space-y-4">
          <h3 className="text-xl font-bold flex items-center gap-2 text-emerald-700"><Shield size={20} /> Member Experience & Skills</h3>
          <div className="grid md:grid-cols-2 gap-4 max-h-[800px] overflow-y-auto pr-2">
            {members.filter(m => m.paddlingDescription || m.experience || m.britishCanoeingQualifications).map(m => (
              <div key={m.uid} className="p-4 bg-white rounded-xl space-y-3 border border-slate-100 shadow-sm hover:border-emerald-200 transition-colors">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-bold text-slate-900">{m.displayName}</p>
                    <p className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">{m.role}</p>
                  </div>
                  <Badge variant="default" className="bg-emerald-50 text-emerald-700 border-emerald-100">{m.abilityProfile || "General"}</Badge>
                </div>
                
                {m.paddlingDescription && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Description</p>
                    <p className="text-xs text-slate-600 italic leading-relaxed">"{m.paddlingDescription}"</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 text-[10px]">
                  {m.britishCanoeingQualifications && (
                    <div className="space-y-1">
                      <p className="font-bold text-slate-400 uppercase">Qualifications</p>
                      <p className="text-slate-600">{m.britishCanoeingQualifications}</p>
                    </div>
                  )}
                  {m.kayakingLeadershipExperience && (
                    <div className="space-y-1">
                      <p className="font-bold text-slate-400 uppercase">Leadership</p>
                      <p className="text-slate-600">{m.kayakingLeadershipExperience}</p>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-50">
                  <Badge variant="default" className="text-[9px] py-0 h-4">Years: {m.yearsPaddling || "0"}</Badge>
                  {m.britishCanoeingMember && <Badge variant="default" className="text-[9px] py-0 h-4 border-blue-100 text-blue-600">BC Member</Badge>}
                  {m.thamesLeader && <Badge variant="default" className="text-[9px] py-0 h-4 border-amber-100 text-amber-600">Thames Leader</Badge>}
                  {m.firstAidSafeguarding && <Badge variant="default" className="text-[9px] py-0 h-4 border-red-100 text-red-600">First Aid</Badge>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {activeTab === "rentals" && (
        <Card className="p-6 space-y-4">
          <h3 className="text-xl font-bold flex items-center gap-2 text-blue-700"><Anchor size={20} /> Active Boat Rentals</h3>
          <div className="grid md:grid-cols-2 gap-4 max-h-[800px] overflow-y-auto pr-2">
            {rentals.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400 space-y-2 col-span-2">
                <Anchor size={32} className="opacity-20" />
                <p className="italic text-sm">No active rentals at this time.</p>
              </div>
            )}
            {rentals.map((r: any, i) => {
              const renter = members.find(m => m.uid === r.uid);
              return (
                <div key={i} className="p-4 bg-white rounded-xl border border-slate-100 shadow-sm flex justify-between items-center hover:border-blue-200 transition-colors">
                  <div className="space-y-1">
                    <p className="font-bold text-slate-900">{r.boatName}</p>
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500">
                        {renter?.displayName?.charAt(0) || "?"}
                      </div>
                      <p className="text-xs text-slate-600 font-medium">{renter?.displayName || "Unknown User"}</p>
                    </div>
                    <p className="text-[10px] text-slate-400 flex items-center gap-1">
                      <Calendar size={10} />
                      {r.startDate?.toDate ? format(r.startDate.toDate(), "MMM d") : "N/A"} - {r.endDate?.toDate ? format(r.endDate.toDate(), "MMM d") : "N/A"}
                    </p>
                  </div>
                  <div className="text-right space-y-1">
                    <p className="text-sm font-bold text-blue-600">£{r.totalPrice}</p>
                    <Badge variant={r.status === "active" ? "success" : "default"} className="text-[9px] uppercase tracking-tighter">
                      {r.status || "Active"}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {activeTab === "coupons" && <CouponManager />}
      {activeTab === "clubs" && <PartnerClubsRegistry />}

      {approvalData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="p-6 max-w-md w-full space-y-4">
            <h3 className="text-xl font-bold">Approve Member</h3>
            <div className="space-y-2">
              <label className="text-sm font-medium">Approved By (Instructor)</label>
              <select 
                className="w-full p-2 border rounded-lg"
                value={approvalData.instructor}
                onChange={(e) => setApprovalData({ ...approvalData, instructor: e.target.value })}
              >
                <option value="">Select Instructor...</option>
                {instructors.map(i => (
                  <option key={i.uid} value={i.displayName}>{i.displayName}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Notes for User & Leaders</label>
              <textarea 
                className="w-full p-2 border rounded-lg"
                placeholder="Anything the club should know..."
                value={approvalData.notes}
                onChange={(e) => setApprovalData({ ...approvalData, notes: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Assigned Paddling Level</label>
              <select 
                className="w-full p-2 border rounded-lg bg-emerald-50/50"
                value={approvalData.paddlingLevel || ""}
                onChange={(e) => setApprovalData({ ...approvalData, paddlingLevel: Number(e.target.value) })}
              >
                <option value="">Select Level...</option>
                <option value="1">Level 1: Beginner (Red in Bookings)</option>
                <option value="2">Level 2: Good Paddler</option>
                <option value="3">Level 3: Expert (Underlined in Bookings)</option>
              </select>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setApprovalData(null)}>Cancel</Button>
              {(() => {
                const u = allUsers.find(x => x.uid === approvalData.uid);
                if (u?.onboardingStatus === "pending_leader_approval") return (
                  <>
                    <Button className="flex-1" onClick={() => handleApprove("trial")} disabled={!approvalData.instructor}>Approve Trial</Button>
                    <Button variant="secondary" className="flex-1 px-2 whitespace-nowrap" onClick={() => handleApprove("membership")} disabled={!approvalData.instructor}>Skip Trial</Button>
                  </>
                );
                return (
                  <Button className="flex-1" onClick={() => handleApprove()} disabled={!approvalData.instructor}>
                    {u?.onboardingStatus === "beginner_paid" ? "Mark Assessed" : 
                     u?.onboardingStatus === "trial_active" ? "Final Approve" : "Confirm"}
                  </Button>
                );
              })()}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

const FinancialDashboard = () => {
  const { user, profile } = useAuth();
  const { allUsers: users, visibility: globalVisibility } = useGlobal();
  const { confirm, showReceipt, alert } = useUI();
  const [fbPayments, setFbPayments] = useState<any[]>([]);
  const [supPayments, setSupPayments] = useState<any[]>([]);
  const [fbExpenses, setFbExpenses] = useState<any[]>([]);
  const [supExpenses, setSupExpenses] = useState<any[]>([]);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [showManualPaymentForm, setShowManualPaymentForm] = useState(false);
  const [showIssueCouponsModal, setShowIssueCouponsModal] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedReceiptUrl, setUploadedReceiptUrl] = useState("");
  const [webhookLogs, setWebhookLogs] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"overview" | "payments" | "expenses" | "webhooks">("overview");

  const visibility = useMemo(() => {
    if (!profile) return [];
    const role = profile.role === "admin" ? "financial" : profile.role;
    return globalVisibility[role] || [];
  }, [profile, globalVisibility]);

  const payments = useMemo(() => {
    console.log("[FinancialDashboard] recalculating merged payments. sup:", supPayments.length, "fb:", fbPayments.length);
    const merged = [...supPayments];
    fbPayments.forEach(p => {
      const isDup = merged.some(mp => 
        (mp.uid && p.uid && mp.uid === p.uid && Math.abs(Number(mp.amount) - Number(p.amount)) < 0.01 && mp.type === p.type) ||
        (mp.stripeSessionId && p.stripeSessionId && mp.stripeSessionId === p.stripeSessionId)
      );
      if (!isDup) merged.push({ ...p, source: 'firebase' });
    });
    console.log("[FinancialDashboard] Final merged payments count:", merged.length);
    return merged.sort((a,b) => (b.timestamp?.toDate ? b.timestamp.toDate().getTime() : 0) - (a.timestamp?.toDate ? a.timestamp.toDate().getTime() : 0));
  }, [fbPayments, supPayments]);

  const expenses = useMemo(() => {
    console.log("[FinancialDashboard] recalculating merged expenses. sup:", supExpenses.length, "fb:", fbExpenses.length);
    const merged = [...supExpenses];
    fbExpenses.forEach(e => {
      const isDup = merged.some(me => 
        me.description === e.description && 
        Math.abs(Number(me.amount) - Number(e.amount)) < 0.01
      );
      if (!isDup) merged.push({ ...e, source: 'firebase' });
    });
    console.log("[FinancialDashboard] Final merged expenses count:", merged.length);
    return merged.sort((a,b) => (b.timestamp?.toDate ? b.timestamp.toDate().getTime() : 0) - (a.timestamp?.toDate ? a.timestamp.toDate().getTime() : 0));
  }, [fbExpenses, supExpenses]);

  useEffect(() => {
    if (!user || !profile) return;
    
    const isPrivileged = profile.role === "admin" || profile.role === "financial";
    if (!isPrivileged) {
      console.warn("[FinancialDashboard] User lacks required role for live listeners");
      return;
    }

    // Check if the current URL matches what we think it should be for webhooks
    const expectedUrl = window.location.origin + "/api/webhook";
    console.log("[Webhook Diagnostic] Expected Endpoint:", expectedUrl);
    
    let unsubPayments = () => {};
    let unsubExpenses = () => {};
    let unsubWebhooks = () => {};

    if (db) {
      unsubPayments = onSnapshot(query(collection(db, "payments"), orderBy("timestamp", "desc")), (snapshot) => {
        console.log(`[FinancialDashboard] Snapshot received: ${snapshot.size} Firebase payments`);
        setFbPayments(snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            source: "Firebase",
            // Normalize legacy fields
            amount: Number(data.amount || data.total || data.amount_total || 0),
            uid: data.uid || data.user_id || data.userId,
            timestamp: data.timestamp || data.created_at || data.date || { toDate: () => new Date() }
          };
        }));
      }, (error) => {
        console.error("[FinancialDashboard] Payments listener failed:", error);
        handleFirestoreError(error, OperationType.LIST, "payments");
      });

      unsubExpenses = onSnapshot(query(collection(db, "expenses"), orderBy("timestamp", "desc")), (snapshot) => {
        console.log(`[FinancialDashboard] Snapshot received: ${snapshot.size} Firebase expenses`);
        setFbExpenses(snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            source: "Firebase",
            amount: Number(data.amount || data.total || 0),
            timestamp: data.timestamp || data.created_at || data.date || { toDate: () => new Date() }
          };
        }));
      }, (error) => {
        console.error("[FinancialDashboard] Expenses listener failed:", error);
        handleFirestoreError(error, OperationType.LIST, "expenses");
      });

      unsubWebhooks = onSnapshot(query(collection(db, "webhook_logs"), orderBy("timestamp", "desc"), limit(20)), (snapshot) => {
        setWebhookLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, (error) => {
        console.warn("Firebase webhooks listener failed.");
      });
    }

    if (supabase) {
       const fetchPayments = async () => {
         console.log("[FinancialDashboard] Fetching Supabase payments...");
         const { data, error } = await supabase.from('payments').select('*').order('created_at', { ascending: false });
         if (error) console.error("[FinancialDashboard] Supabase payments error:", error);
         if (data) {
           console.log(`[FinancialDashboard] Found ${data.length} Supabase payments`);
           setSupPayments(data.map(p => ({
              id: p.id.toString(),
              uid: p.user_id,
              amount: Number(p.amount),
              type: p.type,
              description: p.description,
              stripeSessionId: p.stripe_session_id,
              source: 'supabase',
              timestamp: { toDate: () => new Date(p.created_at) }
           })));
         }
       };

       const fetchExpenses = async () => {
         const { data } = await supabase.from('expenses').select('*').order('created_at', { ascending: false });
         if (data) {
           setSupExpenses(data.map(e => ({
              id: e.id.toString(),
              amount: Number(e.amount),
              description: e.description,
              authorisedBy: e.authorised_by,
              imageUrl: e.image_url,
              source: 'supabase',
              timestamp: { toDate: () => new Date(e.created_at) }
           })));
         }
       };

       fetchPayments();
       fetchExpenses();

       const paySub = supabase.channel('table-db-changes')
         .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => fetchPayments())
         .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, () => fetchExpenses())
         .subscribe();

       return () => { 
         unsubPayments(); unsubExpenses(); unsubWebhooks(); 
         paySub.unsubscribe();
       };
    }

    return () => { unsubPayments(); unsubExpenses(); unsubWebhooks(); };
  }, [user, profile]);

  const canViewFinances = profile?.role === "admin" || profile?.role === "financial";
  const canUploadExpense = canViewFinances || visibility.includes("upload_expense");
  const canRecordManual = canViewFinances || visibility.includes("manual_payment");

  const [syncSessionId, setSyncSessionId] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);

  const handleManualSyncStripe = async () => {
    if (!syncSessionId || !user) return;
    setIsSyncing(true);
    try {
      const resp = await fetch("/api/admin/verify-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: syncSessionId, userId: user.uid })
      });
      const data = await safeJson(resp);
      if (!resp.ok) throw new Error(data.error || "Manual sync failed");
      alert("Success! Stripe session synced to database.");
      setSyncSessionId("");
    } catch (e: any) {
      alert(e.message || "Failed to sync session.");
    } finally {
      setIsSyncing(false);
    }
  };

  if (!canUploadExpense && !canRecordManual) {
    console.warn("[FinancialDashboard] Access blocked: ", { canUploadExpense, canRecordManual, role: profile?.role });
    return <Home />;
  }
  
  const totalReceived = payments.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const totalPaid = expenses.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const balance = totalReceived - totalPaid;

  const isVisible = (field: string) => profile?.role === "admin" || visibility.includes(field);

  const handleExpenseSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsUploading(true);
    const formData = new FormData(e.currentTarget);
    const receiptRef = formData.get("receiptRef") as string;
    
    try {
      if (db) {
        await addDoc(collection(db, "expenses"), {
          amount: Number(formData.get("amount")),
          description: formData.get("description"),
          authorisedBy: formData.get("authorisedBy"),
          imageUrl: receiptRef, // reusing imageUrl field for reference
          timestamp: serverTimestamp(),
          uploadedBy: user?.uid,
          uploadedByName: profile?.displayName
        });
      }

      if (supabase) {
        const { error: supErr } = await supabase.from('expenses').insert({
          amount: Number(formData.get("amount")),
          description: formData.get("description"),
          authorised_by: formData.get("authorisedBy"),
          image_url: receiptRef
        });
        if (supErr) console.error("[Supabase Expense Error]", supErr);
      }

      setShowExpenseForm(false);
      setUploadedReceiptUrl("");
    } catch (error) {
      if (db) handleFirestoreError(error, OperationType.CREATE, "expenses");
      else alert("Expense submission failed. Check console.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-8 py-8">
      <IssueCouponsModal 
        isOpen={showIssueCouponsModal} 
        onClose={() => setShowIssueCouponsModal(false)}
        users={users}
      />
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div className="space-y-2">
          <h2 className="text-3xl font-bold">Financial Overview</h2>
          <p className="text-slate-600">Track club revenue, membership payments, and expenses.</p>
        </div>
        <div className="flex gap-4">
          <div className="flex bg-slate-100 p-1 rounded-xl">
            <button 
              onClick={() => setActiveTab("overview")}
              className={cn("px-4 py-2 rounded-lg font-bold transition-all", activeTab === "overview" ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500")}
            >
              Overview
            </button>
            <button 
              onClick={() => setActiveTab("payments")}
              className={cn("px-4 py-2 rounded-lg font-bold transition-all", activeTab === "payments" ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500")}
            >
              Payments
            </button>
            <button 
              onClick={() => setActiveTab("expenses")}
              className={cn("px-4 py-2 rounded-lg font-bold transition-all", activeTab === "expenses" ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500")}
            >
              Expenses
            </button>
            {profile?.role === "admin" && (
              <button 
                onClick={() => setActiveTab("webhooks")}
                className={cn("px-4 py-2 rounded-lg font-bold transition-all", activeTab === "webhooks" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500")}
              >
                Webhooks
              </button>
            )}
          </div>
          {canRecordManual && activeTab !== "webhooks" && (
            <Button onClick={() => { setShowManualPaymentForm(!showManualPaymentForm); setShowExpenseForm(false); }} variant={showManualPaymentForm ? "outline" : "secondary"} className="bg-blue-600 hover:bg-blue-700">
              {showManualPaymentForm ? "Cancel" : "Manual Payment"}
            </Button>
          )}
          {canUploadExpense && (
            <div className="flex gap-2">
              <Button onClick={() => setShowIssueCouponsModal(true)} variant="outline" className="bg-white border-slate-200 text-emerald-600 hover:bg-emerald-50">
                <Ticket size={18} className="mr-2" /> Issue Codes
              </Button>
              <Button onClick={() => { setShowExpenseForm(!showExpenseForm); setShowManualPaymentForm(false); }} variant={showExpenseForm ? "outline" : "primary"}>
                {showExpenseForm ? "Cancel" : "Upload Expense"}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Recap Section */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="p-6 bg-emerald-50 border-emerald-100">
              <p className="text-sm text-emerald-600 font-bold uppercase tracking-wider">Total Received</p>
              <p className="text-3xl font-bold text-emerald-900">£{totalReceived.toLocaleString()}</p>
              <div className="flex gap-2 mt-2">
                <span className="text-[10px] text-slate-400">FB: {fbPayments.length}</span>
                <span className="text-[10px] text-slate-400">SUP: {supPayments.length}</span>
              </div>
            </Card>
            <Card className="p-6 bg-red-50 border-red-100">
              <p className="text-sm text-red-600 font-bold uppercase tracking-wider">Total Paid (Expenses)</p>
              <p className="text-3xl font-bold text-red-900">£{totalPaid.toLocaleString()}</p>
              <div className="flex gap-2 mt-2">
                <span className="text-[10px] text-slate-400">FB: {fbExpenses.length}</span>
                <span className="text-[10px] text-slate-400">SUP: {supExpenses.length}</span>
              </div>
            </Card>
            <Card className={cn("p-6 border-2", balance >= 0 ? "bg-blue-50 border-blue-200" : "bg-amber-50 border-amber-200")}>
              <p className="text-sm text-slate-500 font-bold uppercase tracking-wider">General Total (Balance)</p>
              <p className={cn("text-3xl font-bold", balance >= 0 ? "text-blue-900" : "text-amber-900")}>£{balance.toLocaleString()}</p>
              <div className="mt-2 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                <span className="text-[10px] text-slate-400 uppercase font-bold">Consolidated Data v4.12</span>
              </div>
            </Card>
          </div>
          
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white rounded-lg border border-slate-100 shadow-sm">
                <ShieldCheck className="text-emerald-500" size={18} />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">Database Consistency Check</p>
                <p className="text-xs text-slate-500">Your financial records are being merged from Firebase and Supabase in real-time.</p>
              </div>
            </div>
            <div className="flex gap-4 pr-4">
              <div className="text-center">
                <p className="text-xs font-bold text-slate-700">{payments.length}</p>
                <p className="text-[10px] text-slate-400 uppercase">Payments</p>
              </div>
              <div className="text-center">
                <p className="text-xs font-bold text-slate-700">{expenses.length}</p>
                <p className="text-[10px] text-slate-400 uppercase">Expenses</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "webhooks" && profile?.role === "admin" && (
        <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
          <Card className="p-6 border-blue-100 bg-blue-50/30">
            <h3 className="text-xl font-bold flex items-center gap-2 text-blue-900 mb-4">
              <Zap size={20} className="text-blue-500 animate-pulse" /> Webhook Diagnostic Assistant (v4.12)
            </h3>
            
            <div className="grid md:grid-cols-2 gap-8 mb-8">
              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  If Stripe payments aren't appearing, use the session ID from your Stripe Dashboard (starts with <code className="bg-white px-1 rounded">cs_...</code>) 
                  to manually trigger a sync.
                </p>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    placeholder="cs_test_..." 
                    className="flex-1 p-2 border rounded-lg shadow-sm"
                    value={syncSessionId}
                    onChange={(e) => setSyncSessionId(e.target.value)}
                  />
                  <Button onClick={handleManualSyncStripe} disabled={!syncSessionId || isSyncing} className="bg-blue-600">
                    {isSyncing ? "Syncing..." : "Force Sync Session"}
                  </Button>
                </div>
                
                <div className="bg-white p-4 rounded-xl border border-blue-100 shadow-sm mt-4">
                  <p className="text-xs font-bold text-slate-400 uppercase mb-2">Endpoint URL for Stripe</p>
                  <div className="flex items-center gap-2 bg-slate-50 p-2 rounded border border-slate-200">
                    <code className="text-xs text-blue-600 font-mono flex-1 truncate">{window.localOrigin || window.location.origin}/api/webhook</code>
                    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => {
                       navigator.clipboard.writeText(window.location.origin + "/api/webhook");
                       alert("Copied to clipboard!");
                    }}>Copy</Button>
                  </div>
                </div>
              </div>
              
              <div className="bg-white p-4 rounded-xl border border-blue-100 shadow-sm">
                <h4 className="font-bold text-sm mb-4 flex items-center gap-2"><ActivityIcon size={14} /> System Health</h4>
                <div className="space-y-3">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full text-xs font-bold h-10 border-blue-200 text-blue-700 hover:bg-blue-50"
                    onClick={async () => {
                      try {
                        const r = await fetch("/api/admin/system-check");
                        const d = await safeJson(r);
                        alert(`Firebase: ${d.status}\nSupabase: ${d.supabaseStatus}\nProject: ${d.activeProjectId}`);
                      } catch (e: any) {
                        alert("API Unreachable: " + e.message);
                      }
                    }}
                  >
                    <RefreshCw size={14} className="mr-2" />
                    Test API Connection
                  </Button>
                  <div className="bg-slate-50 p-3 rounded-lg text-[10px] text-slate-500 font-mono">
                    <p>Webhooks: {webhookLogs.length} attempts recorded</p>
                    <p>Status: {webhookLogs.filter(l => l.status === 'processed').length} success / {webhookLogs.filter(l => l.status === 'error').length} fail</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-bold flex items-center gap-2">Recent Webhook Activity</h3>
              <div className="overflow-x-auto border rounded-xl bg-white shadow-sm font-sans">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="p-4">Timestamp</th>
                      <th className="p-4">Event Type</th>
                      <th className="p-4">Status</th>
                      <th className="p-4">Details</th>
                      <th className="p-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {webhookLogs.length === 0 ? (
                      <tr><td colSpan={5} className="p-8 text-center text-slate-400 italic">No webhook activity found.</td></tr>
                    ) : (
                      webhookLogs.map(log => (
                        <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="p-4 whitespace-nowrap text-xs text-slate-500">
                            {log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString() : new Date(log.timestamp).toLocaleString()}
                          </td>
                          <td className="p-4">
                            <span className="font-mono text-[10px] px-2 py-1 bg-slate-100 rounded text-slate-600">
                              {log.eventType || "Unknown"}
                            </span>
                          </td>
                          <td className="p-4">
                            <Badge variant={log.status === "processed" ? "success" : log.status === "error" || log.status === "failed" ? "destructive" : "warning"}>
                              {log.status}
                            </Badge>
                          </td>
                          <td className="p-4 text-[10px] max-w-xs truncate text-slate-400">
                            {log.error || log.syncResult?.success ? "Processed OK" : JSON.stringify(log.syncResult)}
                          </td>
                          <td className="p-4 text-right">
                            <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => {
                              const sId = log.syncResult?.sessionId || log.stripeSessionId;
                              if (sId) { 
                                setSyncSessionId(sId);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }
                              else alert("ID missing in log.");
                            }}>
                              Use ID
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
        </div>
      )}

      {showManualPaymentForm && (
        <Card className="p-6 max-w-2xl mx-auto border-blue-200 shadow-lg">
          <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-blue-800">
            <Plus size={20} /> Record Manual Payment
          </h3>
          <form onSubmit={async (e) => {
            e.preventDefault();
            setIsUploading(true);
            const formData = new FormData(e.currentTarget);
            try {
              const paymentData = {
                amount: Number(formData.get("amount")),
                description: formData.get("description"),
                type: "manual",
                status: "completed",
                uid: formData.get("userId"),
                userEmail: users.find(u => u.uid === formData.get("userId"))?.email || "manual@record",
                timestamp: serverTimestamp(),
                recordedBy: user?.uid,
                recordedByName: profile?.displayName
              };
              if (db) {
                await addDoc(collection(db, "payments"), paymentData);
              }
              if (supabase) {
                const { error: supErr } = await supabase.from('payments').insert({
                   amount: paymentData.amount,
                   user_id: paymentData.uid,
                   user_email: paymentData.userEmail,
                   description: paymentData.description,
                   type: 'manual',
                   status: 'completed'
                });
                if (supErr) console.error("[Supabase Manual Payment Sync Error]", supErr);
              }
              setShowManualPaymentForm(false);
            } catch (error) {
              handleFirestoreError(error, OperationType.CREATE, "payments");
            } finally {
              setIsUploading(false);
            }
          }} className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Amount (£) *</label>
                <input type="number" name="amount" required className="w-full p-2 border rounded-lg" placeholder="0.00" step="0.01" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Member *</label>
                <select name="userId" required className="w-full p-2 border rounded-lg">
                  <option value="">Select Member</option>
                  {users.sort((a,b) => (a.firstName || "").localeCompare(b.firstName || "")).map(u => (
                    <option key={u.uid} value={u.uid}>{u.firstName} {u.lastName} ({u.email})</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description *</label>
              <textarea name="description" required className="w-full p-2 border rounded-lg h-24" placeholder="e.g. Cash payment for pool session" />
            </div>
            <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700" disabled={isUploading}>
              {isUploading ? "Recording..." : "Record Payment"}
            </Button>
          </form>
        </Card>
      )}

      {showExpenseForm && (
        <Card className="p-6 max-w-2xl mx-auto border-emerald-200 shadow-lg">
          <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-emerald-800">
            <Upload size={20} /> New Expense Upload
          </h3>
          <form onSubmit={handleExpenseSubmit} className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Amount (£) *</label>
                <input type="number" name="amount" required className="w-full p-2 border rounded-lg" placeholder="0.00" step="0.01" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Authorised By *</label>
                <select name="authorisedBy" required className="w-full p-2 border rounded-lg">
                  <option value="Chairperson">Chairperson</option>
                  <option value="Treasurer">Treasurer</option>
                  <option value="Equipment Officer">Equipment Officer</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description *</label>
              <textarea name="description" required className="w-full p-2 border rounded-lg h-24" placeholder="What was this expense for?" />
            </div>
            <div className="space-y-4 pt-2 border-t">
              <label className="text-sm font-medium">Receipt Reference / Link</label>
              <input 
                name="receiptRef" 
                placeholder="Reference number or link" 
                className="w-full p-2 border rounded-lg"
              />
              <p className="text-[10px] text-slate-400">Google Drive integration is temporarily disabled. Please provide a manual reference or link for now.</p>
            </div>
            <Button type="submit" className="w-full" disabled={isUploading}>
              {isUploading ? "Uploading..." : "Submit Expense"}
            </Button>
          </form>
        </Card>
      )}

      {(activeTab === "overview" || activeTab === "payments" || activeTab === "expenses") && (
        <div className="grid lg:grid-cols-3 gap-8">
        <Card className="p-6 space-y-4 lg:col-span-2">
          <div className="flex justify-between items-center">
            <h3 className="text-xl font-bold flex items-center gap-2"><CreditCard size={20} /> Financial Transactions</h3>
            <div className="flex gap-2">
              <input 
                type="text" 
                placeholder="cs_test_..." 
                className="text-xs p-1 border rounded-lg w-40"
                value={syncSessionId}
                onChange={(e) => setSyncSessionId(e.target.value)}
              />
              <Button size="sm" variant="outline" onClick={handleManualSyncStripe} disabled={!syncSessionId || isSyncing}>
                {isSyncing ? "Syncing..." : "Sync Stripe ID"}
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="p-3 text-xs font-bold text-slate-500 uppercase">Date</th>
                  <th className="p-3 text-xs font-bold text-slate-500 uppercase">Type</th>
                  <th className="p-3 text-xs font-bold text-slate-500 uppercase">Description</th>
                  <th className="p-3 text-xs font-bold text-slate-500 uppercase">Uploader</th>
                  <th className="p-3 text-xs font-bold text-slate-500 uppercase">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {/* Combined list of payments and expenses */}
                {(() => {
                  const displayItems = [
                    ...payments.map(p => ({ ...p, isExpense: false })), 
                    ...expenses.map(e => ({ ...e, isExpense: true }))
                  ]
                  .filter(item => {
                    if (activeTab === "payments") return item.isExpense === false;
                    if (activeTab === "expenses") return item.isExpense === true;
                    return true; // overview
                  })
                  .sort((a, b) => {
                    const timeA = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : 0;
                    const timeB = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : 0;
                    return timeB - timeA;
                  })
                  .slice(0, 50);
                  console.log("[FinancialDashboard] Rendering", displayItems.length, "items in table");
                  return displayItems.map((item, i) => (
                    <tr key={item.id || `fin-${i}`} className={item.isExpense ? "bg-red-50/30" : ""}>
                      <td className="p-3 text-sm text-slate-600">
                        {item.timestamp?.toDate ? format(item.timestamp.toDate(), "MMM d, yyyy HH:mm") : "N/A"}
                      </td>
                      <td className="p-3 text-sm">
                        <Badge variant={item.isExpense ? "warning" : "success"}>
                          {item.isExpense ? "EXPENSE" : item.type?.replace("_", " ").toUpperCase()}
                        </Badge>
                      </td>
                      <td className="p-3 text-sm">
                        <div className="font-medium text-slate-800">
                          {item.isExpense ? item.description : (item.description || item.boatName || item.type?.replace("_", " "))}
                        </div>
                        {item.isExpense && (
                          <div className="flex items-center gap-2 mt-1">
                            <div className="text-[10px] text-slate-400 uppercase font-bold tracking-tight">Auth: {item.authorisedBy}</div>
                            {item.imageUrl && (
                              <button onClick={() => showReceipt(item.imageUrl)} className="text-[10px] text-emerald-600 hover:underline flex items-center gap-0.5">
                                <ExternalLink size={10} /> View Receipt
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-sm text-slate-500">
                        <div className="flex flex-col">
                           <span className="text-[9px] font-black uppercase text-slate-300">[{item.source || 'Legacy'}]</span>
                           <span>
                             {item.isExpense ? (item.uploadedByName || "System") : 
                              item.type === "manual" ? (item.recordedByName || "Admin") : "Stripe"}
                           </span>
                        </div>
                      </td>
                      <td className={cn("p-3 text-sm font-bold", item.isExpense ? "text-red-600" : "text-emerald-600")}>
                        {item.isExpense ? "-" : "+"}£{item.amount?.toLocaleString()}
                        {canViewFinances && (
                          <div className="inline-flex gap-2 ml-4">
                              <button 
                                onClick={async () => {
                                  if (!item.id) {
                                    alert("Cannot delete: Entry ID missing.");
                                    return;
                                  }
                                  if (window.confirm(`Delete this ${item.isExpense ? "expense" : "payment"} entry?`)) {
                                    try {
                                      console.log(`[Finance] Deleting ${item.isExpense ? 'expense' : 'payment'}: ${item.id}`);
                                      if (db) await deleteDoc(doc(db, item.isExpense ? "expenses" : "payments", item.id!));
                                      if (supabase) {
                                        const { error: supErr } = await supabase.from(item.isExpense ? 'expenses' : 'payments').delete().eq('id', item.id);
                                        if (supErr) console.error("[Supabase Finance Delete Error]", supErr);
                                      }
                                      alert("Entry deleted successfully.");
                                    } catch (e) {
                                      if (db) handleFirestoreError(e, OperationType.DELETE, item.isExpense ? "expenses" : "payments");
                                      else console.error("Entry deletion failed.", e);
                                    }
                                  }
                                }}
                                className="text-slate-300 hover:text-red-500 transition-colors p-1 rounded-full hover:bg-red-50"
                              >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                })()}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-6 space-y-4">
          <h3 className="text-xl font-bold flex items-center gap-2 text-emerald-700"><Users size={20} /> Member Status</h3>
          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
            {users.map(u => (
              <div key={u.uid} className="flex items-center justify-between p-4 bg-white rounded-xl border border-slate-100 shadow-sm hover:border-emerald-200 transition-colors">
                <div className="space-y-1">
                  <p className="font-bold text-slate-900">{u.displayName}</p>
                  {isVisible("email") && <p className="text-xs text-slate-500">{u.email}</p>}
                  <div className="flex gap-2 text-[10px] text-slate-400">
                    {isVisible("memberNumber") && <span>Member #: {u.memberNumber || "N/A"}</span>}
                  </div>
                </div>
                <div className="text-right space-y-2">
                  <Badge variant={u.onboardingStatus === "membership_paid" ? "success" : "warning"} className="text-[10px]">
                    {u.onboardingStatus === "membership_paid" ? "Paid" : "Pending"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      )}
    </div>
  );
};

const IssueCouponsModal = ({ isOpen, onClose, users }: { isOpen: boolean, onClose: () => void, users: UserProfile[] }) => {
  const { alert } = useUI();
  const [targetUserId, setTargetUserId] = useState("");
  const [count, setCount] = useState(10);
  const [type, setType] = useState<"club" | "child">("club");
  const [bankReference, setBankReference] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isOpen) return null;

  const partnerClubs = users.filter(u => u.role === "partner_club" || u.role === "admin");

  const handleIssue = async () => {
    if (!targetUserId) return alert("Select a club.");
    const targetClub = partnerClubs.find(u => u.uid === targetUserId);
    
    setIsProcessing(true);
    try {
      const response = await fetch("/api/admin/issue-manual-coupons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId,
          targetUserEmail: targetClub?.email,
          count,
          type,
          bankReference
        })
      });

      if (response.ok) {
        alert("Success! Codes issued and email sent to partner.");
        onClose();
      } else {
        const error = await response.json();
        throw new Error(error.error || "Failed to issue codes");
      }
    } catch (e: any) {
      console.error(e);
      alert("Error: " + e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[110] flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8 animate-in zoom-in-95 duration-200 text-left">
        <h2 className="text-2xl font-black mb-6 italic">Manual Issue Coupons</h2>
        <div className="space-y-4">
          <p className="text-xs text-slate-500 mb-4 font-medium leading-relaxed">
            Issue assessment codes to Partner Clubs who paid via **Manual/Bank Transfer**. Verified partner accounts are listed in the dropdown.
          </p>
          <div>
            <label className="text-xs font-bold uppercase text-slate-500 mb-1 block tracking-widest">Recipient Club</label>
            <select 
              className="w-full p-3 border rounded-xl bg-white text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
            >
              <option value="">-- Select a Partner Club --</option>
              {partnerClubs.map(u => (
                <option key={u.uid} value={u.uid}>{u.displayName} ({u.email})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold uppercase text-slate-500 mb-1 block tracking-widest">Bank Reference / Payment Details</label>
            <input 
              type="text"
              placeholder="e.g. BTC-240429-PHOENIX"
              className="w-full p-3 border rounded-xl text-sm"
              value={bankReference}
              onChange={(e) => setBankReference(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold uppercase text-slate-500 mb-1 block tracking-widest">Type</label>
              <select 
                className="w-full p-3 border rounded-xl bg-white text-sm"
                value={type}
                onChange={(e) => setType(e.target.value as "club" | "child")}
              >
                <option value="club">Adult (£10)</option>
                <option value="child">Child (£5)</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold uppercase text-slate-500 mb-1 block tracking-widest">Quantity</label>
              <input 
                type="number" 
                className="w-full p-3 border rounded-xl" 
                value={count} 
                onChange={(e) => setCount(parseInt(e.target.value) || 0)}
                min={1}
                max={100}
              />
            </div>
          </div>
          <div className="flex gap-2 pt-4">
            <Button variant="outline" className="flex-1 font-bold h-12 rounded-xl" onClick={onClose}>Cancel</Button>
            <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700 font-bold h-12 rounded-xl shadow-lg shadow-emerald-100" onClick={handleIssue} disabled={isProcessing}>
              {isProcessing ? "Issuing..." : "Confirm & Issue"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};

const SocialDashboard = () => {
  const { user, profile } = useAuth();
  const { allUsers, allBoats, visibility: globalVisibility } = useGlobal();
  const { alert, confirm } = useUI();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<"newsletter" | "experiences" | "polls" | "groups">(
    profile?.role === "social" || profile?.role === "admin" ? "newsletter" : "experiences"
  );

  // Firestore collections states
  const [snippets, setSnippets] = useState<any[]>([]);
  const [newsletters, setNewsletters] = useState<any[]>([]);
  const [stories, setStories] = useState<any[]>([]);
  const [polls, setPolls] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Form states
  const [draftTitle, setDraftTitle] = useState("");
  const [draftNarrative, setDraftNarrative] = useState("");
  const [selectedSnippetIds, setSelectedSnippetIds] = useState<string[]>([]);
  const [isBroadcasting, setIsBroadcasting] = useState(false);

  const [storyTitle, setStoryTitle] = useState("");
  const [storyContent, setStoryContent] = useState("");
  const [storyImg, setStoryImg] = useState("");
  const [showAddStory, setShowAddStory] = useState(false);

  const [pollTitle, setPollTitle] = useState("");
  const [pollDesc, setPollDesc] = useState("");
  const [pollRestriction, setPollRestriction] = useState<"all_members" | "leaders_only">("all_members");
  const [pollDeadline, setPollDeadline] = useState(format(addDays(new Date(), 7), "yyyy-MM-dd"));
  const [showAddPoll, setShowAddPoll] = useState(false);

  const [groupName, setGroupName] = useState("");
  const [groupDesc, setGroupDesc] = useState("");
  const [selectedGroupMemberIds, setSelectedGroupMemberIds] = useState<string[]>([]);
  const [groupRoleFilter, setGroupRoleFilter] = useState("All");

  const [activePollComments, setActivePollComments] = useState<{ [pollId: string]: string }>({});

  useEffect(() => {
    if (!db) return;
    setLoading(true);

    const unsubSnippets = onSnapshot(collection(db, "snippets"), (snap) => {
      setSnippets(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubNewsletters = onSnapshot(collection(db, "newsletters"), (snap) => {
      setNewsletters(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubStories = onSnapshot(query(collection(db, "stories"), orderBy("createdAt", "desc")), (snap) => {
      setStories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubPolls = onSnapshot(query(collection(db, "polls"), orderBy("createdAt", "desc")), (snap) => {
      setPolls(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubGroups = onSnapshot(collection(db, "social_groups"), (snap) => {
      setGroups(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    setLoading(false);

    return () => {
      unsubSnippets();
      unsubNewsletters();
      unsubStories();
      unsubPolls();
      unsubGroups();
    };
  }, []);

  const isSocialManager = profile?.role === "social" || profile?.role === "admin";

  const members = useMemo(() => {
    return allUsers.filter(u => ["member", "leader", "admin", "instructor"].includes(u.role));
  }, [allUsers]);

  // Tab 1: Newsletter Compilation & Sending
  const toggleSnippetSelection = (id: string) => {
    setSelectedSnippetIds(prev => 
      prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
    );
  };

  const compileAndSendNewsletter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftTitle || !draftNarrative) return;
    setIsBroadcasting(true);

    try {
      // Gather content from selected snippets
      const selectedSnippets = snippets.filter(s => selectedSnippetIds.includes(s.id));
      let snippetsHtml = "";
      
      selectedSnippets.forEach(s => {
        snippetsHtml += `
          <div style="background: #f8fafc; border-left: 4px solid #059669; padding: 15px; margin: 15px 0; border-radius: 4px;">
            <h4 style="margin: 0 0 5px 0; color: #0f172a;">${s.eventTitle || 'Session Log'} - Led by ${s.leaderName}</h4>
            <p style="font-size: 12px; color: #475569; margin: 0 0 8px 0;">
              <b>Conditions:</b> Temp: ${s.weather?.temperature || 'TBC'}°C | Flow: ${s.weather?.waterFlowThames || 'Normal'} | Tide: ${s.weather?.tideHeight || 'TBC'}
            </p>
            <p style="margin: 0; font-size: 13px; color: #334155;">${s.summary || ''}</p>
            ${s.newcomerPerformance ? `<p style="margin: 8px 0 0 0; font-size: 12px; color: #0891b2;"><b>Newcomers Info:</b> ${s.newcomerPerformance}</p>` : ''}
          </div>
        `;
      });

      const htmlContent = `
        <h1 style="color: #059669; font-style: italic; font-weight: 900; border-bottom: 2px solid #059669; padding-bottom: 10px;">${draftTitle}</h1>
        <p style="font-size: 15px; line-height: 1.6; color: #1e293b; white-space: pre-wrap;">${draftNarrative}</p>
        
        ${selectedSnippets.length > 0 ? `
          <h3 style="color: #0f172a; margin-top: 30px; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px;">🚣 Active River Session Reports</h3>
          ${snippetsHtml}
        ` : ''}
      `;

      // Save newsletter to Firestore archive
      let newsletterId = "";
      if (db) {
        const docRef = await addDoc(collection(db, "newsletters"), {
          title: draftTitle,
          narrative: draftNarrative,
          snippetIds: selectedSnippetIds,
          status: "sent",
          sentAt: serverTimestamp(),
          createdBy: user?.uid
        });
        newsletterId = docRef.id;
      }

      // Send via Express SMTP API
      const recipientEmails = members.map(m => m.email).filter(Boolean);
      
      const response = await fetch("/api/social/send-newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emails: recipientEmails,
          subject: draftTitle,
          htmlContent
        })
      });

      if (!response.ok) throw new Error("Newsletter broadcast API failed.");

      alert(`Newsletter successfully archived and broadcasting to ${recipientEmails.length} club members!`);
      
      // Reset form
      setDraftTitle("");
      setDraftNarrative("");
      setSelectedSnippetIds([]);
    } catch (err: any) {
      console.error(err);
      alert("Error sending newsletter: " + err.message);
    } finally {
      setIsBroadcasting(false);
    }
  };

  // Tab 2: Stories Submit
  const submitStory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storyTitle || !storyContent) return;

    try {
      if (db) {
        await addDoc(collection(db, "stories"), {
          title: storyTitle,
          content: storyContent,
          imageUrl: storyImg || `https://picsum.photos/seed/${storyTitle}/600/400`,
          submitterId: user?.uid,
          submitterName: profile?.displayName || user?.email || "Anonymous",
          createdAt: serverTimestamp()
        });
      }
      alert("Your club experience story has been published on the board!");
      setStoryTitle("");
      setStoryContent("");
      setStoryImg("");
      setShowAddStory(false);
    } catch (err: any) {
      alert("Story submission failed: " + err.message);
    }
  };

  // Tab 3: Poll Creator
  const submitPoll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pollTitle || !pollDesc) return;

    try {
      if (db) {
        await addDoc(collection(db, "polls"), {
          title: pollTitle,
          description: pollDesc,
          restriction: pollRestriction,
          deadline: pollDeadline,
          createdBy: user?.uid,
          creatorName: profile?.displayName || "Leader",
          votes: {}, // maps uid -> "approve" | "disapprove" | "abstain"
          comments: [],
          createdAt: serverTimestamp()
        });
      }
      alert("Discussion Poll launched successfully!");
      setPollTitle("");
      setPollDesc("");
      setShowAddPoll(false);
    } catch (err: any) {
      alert("Poll creation failed: " + err.message);
    }
  };

  const castVote = async (pollId: string, choice: "approve" | "disapprove" | "abstain") => {
    if (!user) return;
    try {
      if (db) {
        const pollRef = doc(db, "polls", pollId);
        const pollSnap = await getDoc(pollRef);
        if (pollSnap.exists()) {
          const poll = pollSnap.data();
          const updatedVotes = { ...poll.votes, [user.uid]: choice };
          await updateDoc(pollRef, { votes: updatedVotes });
        }
      }
    } catch (err: any) {
      alert("Failed to record vote: " + err.message);
    }
  };

  const submitComment = async (pollId: string) => {
    const text = activePollComments[pollId];
    if (!text || !user || !db) return;

    try {
      const pollRef = doc(db, "polls", pollId);
      const pollSnap = await getDoc(pollRef);
      if (pollSnap.exists()) {
        const poll = pollSnap.data();
        const updatedComments = [
          ...(poll.comments || []),
          {
            userId: user.uid,
            userName: profile?.displayName || "Member",
            text,
            timestamp: new Date().toISOString()
          }
        ];
        await updateDoc(pollRef, { comments: updatedComments });
        setActivePollComments(prev => ({ ...prev, [pollId]: "" }));
      }
    } catch (err: any) {
      alert("Failed to submit comment: " + err.message);
    }
  };

  // Tab 4: Groups Creator
  const filteredUsersForGroups = useMemo(() => {
    return allUsers.filter(u => {
      if (groupRoleFilter === "All") return true;
      return u.role === groupRoleFilter;
    });
  }, [allUsers, groupRoleFilter]);

  const toggleGroupMember = (uid: string) => {
    setSelectedGroupMemberIds(prev => 
      prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]
    );
  };

  const saveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName || selectedGroupMemberIds.length === 0) return;

    try {
      if (db) {
        await addDoc(collection(db, "social_groups"), {
          name: groupName,
          description: groupDesc,
          memberIds: selectedGroupMemberIds,
          createdAt: serverTimestamp(),
          createdBy: user?.uid
        });
      }
      alert(`Social communication segment "${groupName}" saved!`);
      setGroupName("");
      setGroupDesc("");
      setSelectedGroupMemberIds([]);
    } catch (err: any) {
      alert("Failed to save group: " + err.message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshCw className="animate-spin text-indigo-600" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-8 py-8 animate-in fade-in duration-200">
      <div className="space-y-2">
        <h2 className="text-3xl font-black italic">Social & <span className="text-indigo-600">Communication</span></h2>
        <p className="text-slate-600">Share trip reports, vote on club matters, and connect with the PBCC community.</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 overflow-x-auto">
        {isSocialManager && (
          <button 
            onClick={() => setActiveTab("newsletter")}
            className={cn("px-6 py-3 text-sm font-bold transition-colors border-b-2 whitespace-nowrap", activeTab === "newsletter" ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-400 hover:text-slate-600")}
          >
            Mailing & Newsletters
          </button>
        )}
        <button 
          onClick={() => setActiveTab("experiences")}
          className={cn("px-6 py-3 text-sm font-bold transition-colors border-b-2 whitespace-nowrap", activeTab === "experiences" ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-400 hover:text-slate-600")}
        >
          Paddler's Diary
        </button>
        <button 
          onClick={() => setActiveTab("polls")}
          className={cn("px-6 py-3 text-sm font-bold transition-colors border-b-2 whitespace-nowrap", activeTab === "polls" ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-400 hover:text-slate-600")}
        >
          Matters & Decision Polls
        </button>
        {isSocialManager && (
          <button 
            onClick={() => setActiveTab("groups")}
            className={cn("px-6 py-3 text-sm font-bold transition-colors border-b-2 whitespace-nowrap", activeTab === "groups" ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-400 hover:text-slate-600")}
          >
            Communication Groups
          </button>
        )}
      </div>

      {/* Tab Contents */}

      {/* NEWSLETTER HUB */}
      {activeTab === "newsletter" && isSocialManager && (
        <div className="grid lg:grid-cols-3 gap-8">
          <Card className="lg:col-span-2 p-6 space-y-6 shadow-xl border-indigo-50">
            <div>
              <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
                <Mail className="text-indigo-600" /> Compile Monthly Newsletter
              </h3>
              <p className="text-xs text-slate-500">Inject session report snippets directly from event leader logs.</p>
            </div>

            <form onSubmit={compileAndSendNewsletter} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Newsletter Subject Line</label>
                <input 
                  type="text"
                  required
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  placeholder="e.g. PBCC Paddler Monthly: Rivers, Tides & New Recruits"
                  className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Main Message (Narrative)</label>
                <textarea 
                  required
                  value={draftNarrative}
                  onChange={(e) => setDraftNarrative(e.target.value)}
                  placeholder="Draft your main welcome message, dates of upcoming socials, etc..."
                  className="w-full h-48 p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Select Snippets to Include ({selectedSnippetIds.length} chosen)
                </label>
                <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                  {snippets.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No completed session log snippets available yet.</p>
                  ) : (
                    snippets.map(s => (
                      <div 
                        key={s.id} 
                        onClick={() => toggleSnippetSelection(s.id)}
                        className={cn(
                          "p-3 border rounded-xl cursor-pointer hover:border-indigo-300 transition-all text-xs flex justify-between items-center",
                          selectedSnippetIds.includes(s.id) ? "border-indigo-600 bg-indigo-50/50" : "border-slate-200 bg-white"
                        )}
                      >
                        <div>
                          <p className="font-bold text-slate-800">{s.eventTitle} (Led by {s.leaderName})</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">Weather: {s.weather?.temperature}°C, {s.weather?.waterFlowThames}</p>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={selectedSnippetIds.includes(s.id)} 
                          onChange={() => {}} 
                          className="rounded text-indigo-600 focus:ring-indigo-500 pointer-events-none"
                        />
                      </div>
                    ))
                  )}
                </div>
              </div>

              <Button 
                type="submit" 
                disabled={isBroadcasting || !draftTitle} 
                className="w-full h-12 bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
              >
                {isBroadcasting ? <RefreshCw className="animate-spin mr-2" /> : <Zap className="mr-2" />}
                Broadcast Newsletter to All Members
              </Button>
            </form>
          </Card>

          <div className="space-y-6">
            {/* Newsletter Archive */}
            <Card className="p-6 space-y-4 shadow-md bg-white border border-slate-100">
              <h4 className="font-bold text-slate-800 flex items-center gap-2"><History size={16} /> Newsletter Archive</h4>
              <div className="space-y-3 max-h-96 overflow-y-auto pr-2 text-xs">
                {newsletters.map(n => (
                  <div key={n.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                    <p className="font-bold text-slate-800">{n.title}</p>
                    <p className="text-[9px] text-slate-400 uppercase font-mono">
                      Sent on {n.sentAt?.toDate ? format(n.sentAt.toDate(), "dd MMM yyyy") : "TBC"}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* PADDLER DIARY (STORIES) */}
      {activeTab === "experiences" && (
        <div className="space-y-6">
          <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
            <div>
              <h3 className="font-black text-slate-800 text-lg">🚣 The Paddler's Diary</h3>
              <p className="text-xs text-slate-500">Read and share stories about recent trips, pool updates, and safety incidents.</p>
            </div>
            <Button onClick={() => setShowAddStory(true)} className="bg-indigo-600 hover:bg-indigo-700 text-xs">
              <Plus size={16} className="mr-1" /> Post Trip Experience
            </Button>
          </div>

          {showAddStory && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[200] flex items-center justify-center p-4">
              <Card className="w-full max-w-xl p-8 animate-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-black text-slate-800">Share Your Paddling Experience</h3>
                  <button onClick={() => setShowAddStory(false)} className="p-1 hover:bg-slate-100 rounded-full"><X size={20} /></button>
                </div>

                <form onSubmit={submitStory} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400">Story Title</label>
                    <input 
                      type="text" 
                      required 
                      value={storyTitle} 
                      onChange={(e) => setStoryTitle(e.target.value)}
                      placeholder="e.g. Sunny morning paddle past Richmond Lock!" 
                      className="w-full p-2 border rounded-lg"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400">Your Story Narrative</label>
                    <textarea 
                      required 
                      value={storyContent} 
                      onChange={(e) => setStoryContent(e.target.value)}
                      placeholder="How did the paddle go? What was the weather like? Highlight newcomer achievements or equipment notes..." 
                      className="w-full h-32 p-2 border rounded-lg text-sm"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400">Image Link (Optional)</label>
                    <input 
                      type="url" 
                      value={storyImg} 
                      onChange={(e) => setStoryImg(e.target.value)}
                      placeholder="e.g. https://images.unsplash.com/... or base64 data" 
                      className="w-full p-2 border rounded-lg text-xs"
                    />
                  </div>

                  <div className="flex gap-4 pt-4">
                    <Button variant="outline" className="flex-1" type="button" onClick={() => setShowAddStory(false)}>Cancel</Button>
                    <Button className="flex-1 bg-indigo-600 hover:bg-indigo-700" type="submit">Post to Diary</Button>
                  </div>
                </form>
              </Card>
            </div>
          )}

          {/* Stories list */}
          {stories.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-xl border border-slate-200">
              <Compass className="mx-auto text-slate-300 w-12 h-12 mb-3" />
              <p className="text-slate-500 text-sm">No trip stories have been written yet. Be the first to share one!</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {stories.map(s => (
                <Card key={s.id} className="shadow-md hover:shadow-lg transition-shadow bg-white flex flex-col h-full border border-slate-100">
                  <div className="relative h-44 bg-slate-100 overflow-hidden">
                    <img 
                      src={s.imageUrl} 
                      alt={s.title} 
                      className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute top-2 left-2">
                      <Badge variant="secondary" className="bg-slate-900/80 text-white border-none">{s.submitterName}</Badge>
                    </div>
                  </div>
                  <div className="p-4 flex-1 flex flex-col justify-between space-y-4">
                    <div>
                      <h4 className="font-bold text-slate-900 leading-tight mb-2">{s.title}</h4>
                      <p className="text-slate-500 text-xs line-clamp-4 whitespace-pre-wrap">{s.content}</p>
                    </div>
                    <p className="text-[9px] text-slate-400 font-mono text-right border-t pt-2 mt-auto">
                      Posted {s.createdAt?.toDate ? format(s.createdAt.toDate(), "dd MMM yyyy") : "TBC"}
                    </p>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MATTERS & DECISION POLLS */}
      {activeTab === "polls" && (
        <div className="space-y-6">
          <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
            <div>
              <h3 className="font-black text-slate-800 text-lg">🗳️ Matters & Decision Forum</h3>
              <p className="text-xs text-slate-500">View and vote on active club issues. Help manage club growth safely.</p>
            </div>
            {isSocialManager && (
              <Button onClick={() => setShowAddPoll(true)} className="bg-indigo-600 hover:bg-indigo-700 text-xs">
                <Plus size={16} className="mr-1" /> Launch Decision Poll
              </Button>
            )}
          </div>

          {showAddPoll && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[200] flex items-center justify-center p-4">
              <Card className="w-full max-w-xl p-8 animate-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-black text-slate-800">Launch Decision Poll</h3>
                  <button onClick={() => setShowAddPoll(false)} className="p-1 hover:bg-slate-100 rounded-full"><X size={20} /></button>
                </div>

                <form onSubmit={submitPoll} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400">Discussion Issue / Title</label>
                    <input 
                      type="text" 
                      required 
                      value={pollTitle} 
                      onChange={(e) => setPollTitle(e.target.value)}
                      placeholder="e.g. Procuring Valley Sea Kayaks - £1500 grant" 
                      className="w-full p-2 border rounded-lg"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400">Issue Description</label>
                    <textarea 
                      required 
                      value={pollDesc} 
                      onChange={(e) => setPollDesc(e.target.value)}
                      placeholder="State the matter, budget details, proposal highlights, or why we need this..." 
                      className="w-full h-32 p-2 border rounded-lg text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-400">Access Restriction</label>
                      <select 
                        value={pollRestriction} 
                        onChange={(e: any) => setPollRestriction(e.target.value)}
                        className="w-full p-2 border rounded-lg text-sm bg-white"
                      >
                        <option value="all_members">All Members (Public)</option>
                        <option value="leaders_only">Leaders & Admins Only (Restricted)</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-400">Closing Date</label>
                      <input 
                        type="date" 
                        required 
                        value={pollDeadline} 
                        onChange={(e) => setPollDeadline(e.target.value)}
                        className="w-full p-2 border rounded-lg text-sm bg-white"
                      />
                    </div>
                  </div>

                  <div className="flex gap-4 pt-4">
                    <Button variant="outline" className="flex-1" type="button" onClick={() => setShowAddPoll(false)}>Cancel</Button>
                    <Button className="flex-1 bg-indigo-600 hover:bg-indigo-700" type="submit">Launch Poll</Button>
                  </div>
                </form>
              </Card>
            </div>
          )}

          {/* Poll list */}
          {polls.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-xl border border-slate-200">
              <BarChart3 className="mx-auto text-slate-300 w-12 h-12 mb-3" />
              <p className="text-slate-500 text-sm">No matters are currently up for discussion. Check back later!</p>
            </div>
          ) : (
            <div className="space-y-6">
              {polls.map(p => {
                // Enforce Leaders restriction
                const isRestricted = p.restriction === "leaders_only";
                const isLeaderOrAdmin = ["admin", "leader", "instructor"].includes(profile?.role || "");
                if (isRestricted && !isLeaderOrAdmin) return null;

                const votes = p.votes || {};
                const voteCounts = { approve: 0, disapprove: 0, abstain: 0 };
                Object.values(votes).forEach((v: any) => {
                  if (voteCounts[v as keyof typeof voteCounts] !== undefined) {
                    voteCounts[v as keyof typeof voteCounts]++;
                  }
                });

                const totalVotes = voteCounts.approve + voteCounts.disapprove + voteCounts.abstain;
                const pctApprove = totalVotes ? Math.round((voteCounts.approve / totalVotes) * 100) : 0;
                const pctDisapprove = totalVotes ? Math.round((voteCounts.disapprove / totalVotes) * 100) : 0;
                const pctAbstain = totalVotes ? Math.round((voteCounts.abstain / totalVotes) * 100) : 0;

                const hasVoted = votes[user?.uid || ""];
                const deadlineDate = new Date(p.deadline);
                const isClosed = new Date() > deadlineDate;

                return (
                  <Card key={p.id} className="p-6 bg-white border border-slate-100 shadow-md space-y-6">
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-lg font-black text-slate-800">{p.title}</h4>
                          {isRestricted && <Badge variant="destructive" className="bg-red-50 text-red-600 text-[9px] border-red-100">Leaders & Admins</Badge>}
                          {isClosed ? <Badge variant="secondary" className="text-[9px]">Closed</Badge> : <Badge variant="success" className="text-[9px]">Active</Badge>}
                        </div>
                        <p className="text-[10px] text-slate-400">Created by {p.creatorName} • Deadline: {format(deadlineDate, "dd MMM yyyy")}</p>
                      </div>
                    </div>

                    <p className="text-slate-600 text-sm whitespace-pre-wrap">{p.description}</p>

                    {/* Poll voting UI */}
                    <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 space-y-4">
                      <h5 className="text-xs font-black text-slate-800 uppercase tracking-widest">Matters Voting & Discussion</h5>
                      
                      {/* Real-time bar charts */}
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs font-bold text-slate-700">
                            <span>👍 Approve ({voteCounts.approve})</span>
                            <span>{pctApprove}%</span>
                          </div>
                          <div className="w-full bg-slate-200 h-3.5 rounded-full overflow-hidden">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${pctApprove}%` }}
                              className="bg-emerald-500 h-full rounded-full" 
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-xs font-bold text-slate-700">
                            <span>👎 Disapprove ({voteCounts.disapprove})</span>
                            <span>{pctDisapprove}%</span>
                          </div>
                          <div className="w-full bg-slate-200 h-3.5 rounded-full overflow-hidden">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${pctDisapprove}%` }}
                              className="bg-red-500 h-full rounded-full" 
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-xs font-bold text-slate-700">
                            <span>😶 Abstain ({voteCounts.abstain})</span>
                            <span>{pctAbstain}%</span>
                          </div>
                          <div className="w-full bg-slate-200 h-3.5 rounded-full overflow-hidden">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${pctAbstain}%` }}
                              className="bg-slate-400 h-full rounded-full" 
                            />
                          </div>
                        </div>
                      </div>

                      {/* Vote Buttons (if active and not voted) */}
                      {!isClosed && user && (
                        <div className="pt-4 border-t border-slate-200">
                          {hasVoted ? (
                            <div className="flex items-center gap-2 text-xs font-bold text-emerald-600">
                              <CheckCircle2 size={16} /> You voted: <span className="capitalize font-black underline">{hasVoted}</span>
                            </div>
                          ) : (
                            <div className="flex flex-col sm:flex-row gap-2">
                              <button 
                                onClick={() => castVote(p.id, "approve")}
                                className="flex-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 p-2.5 rounded-xl border border-emerald-200 text-xs font-bold transition-all"
                              >
                                👍 Approve
                              </button>
                              <button 
                                onClick={() => castVote(p.id, "disapprove")}
                                className="flex-1 bg-red-50 hover:bg-red-100 text-red-700 p-2.5 rounded-xl border border-red-200 text-xs font-bold transition-all"
                              >
                                👎 Disapprove
                              </button>
                              <button 
                                onClick={() => castVote(p.id, "abstain")}
                                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 p-2.5 rounded-xl border border-slate-200 text-xs font-bold transition-all"
                              >
                                😶 Abstain
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Comments section */}
                    <div className="space-y-3">
                      <h5 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2"><MessageSquare size={14} /> Forum discussion</h5>
                      
                      <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                        {p.comments?.length === 0 ? (
                          <p className="text-xs text-slate-400 italic">No comments posted yet. Start the discussion!</p>
                        ) : (
                          p.comments?.map((c: any, idx: number) => (
                            <div key={idx} className="p-2.5 bg-slate-50 border rounded-xl text-xs space-y-1">
                              <div className="flex justify-between font-bold text-slate-800">
                                <span>{c.userName}</span>
                                <span className="text-[10px] text-slate-400 font-mono">
                                  {format(new Date(c.timestamp), "dd MMM HH:mm")}
                                </span>
                              </div>
                              <p className="text-slate-600">{c.text}</p>
                            </div>
                          ))
                        )}
                      </div>

                      {user && (
                        <div className="flex gap-2 pt-2 border-t">
                          <input 
                            type="text" 
                            placeholder="Add your input to the debate..." 
                            value={activePollComments[p.id] || ""}
                            onChange={(e) => setActivePollComments(prev => ({ ...prev, [p.id]: e.target.value }))}
                            className="flex-1 p-2 text-xs border rounded-lg bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                          <Button size="sm" onClick={() => submitComment(p.id)} className="bg-indigo-600">Send</Button>
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* COMMUNICATION GROUPS */}
      {activeTab === "groups" && isSocialManager && (
        <div className="grid lg:grid-cols-3 gap-8">
          <Card className="lg:col-span-2 p-6 space-y-6 shadow-xl border-indigo-50 bg-white">
            <div>
              <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
                <Users className="text-indigo-600" /> Create Custom Member Segment
              </h3>
              <p className="text-xs text-slate-500">Group members for customized announcements or email campaigns.</p>
            </div>

            <form onSubmit={saveGroup} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-400">Group Name</label>
                  <input 
                    type="text" 
                    required 
                    value={groupName} 
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="e.g. Sea Kayaking Team" 
                    className="w-full p-2.5 border rounded-xl"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-400">Description</label>
                  <input 
                    type="text" 
                    value={groupDesc} 
                    onChange={(e) => setGroupDesc(e.target.value)}
                    placeholder="e.g. Advanced sea kayak certified members" 
                    className="w-full p-2.5 border rounded-xl"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center border-t pt-4">
                  <label className="text-xs font-bold text-slate-800 uppercase tracking-widest block">
                    Choose Members ({selectedGroupMemberIds.length} selected)
                  </label>
                  
                  <select 
                    value={groupRoleFilter} 
                    onChange={(e) => setGroupRoleFilter(e.target.value)}
                    className="p-1 border rounded-lg text-xs bg-white outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="All">All Roles</option>
                    <option value="member">Members</option>
                    <option value="leader">Leaders</option>
                    <option value="instructor">Instructors</option>
                  </select>
                </div>

                <div className="space-y-2 max-h-60 overflow-y-auto pr-2 border p-3 rounded-xl bg-slate-50">
                  {filteredUsersForGroups.map(u => {
                    const name = u.firstName ? `${u.firstName} ${u.lastName}` : u.displayName || u.email;
                    return (
                      <div 
                        key={u.uid} 
                        onClick={() => toggleGroupMember(u.uid)}
                        className={cn(
                          "p-2 border rounded-lg cursor-pointer text-xs flex justify-between items-center transition-all bg-white hover:border-indigo-300",
                          selectedGroupMemberIds.includes(u.uid) ? "border-indigo-600 bg-indigo-50/50" : "border-slate-200"
                        )}
                      >
                        <div>
                          <p className="font-bold text-slate-800">{name}</p>
                          <p className="text-[10px] text-slate-400">{u.email}</p>
                        </div>
                        <Badge variant="default" className="text-[9px]">{u.role}</Badge>
                      </div>
                    );
                  })}
                </div>
              </div>

              <Button type="submit" disabled={selectedGroupMemberIds.length === 0} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold h-11">
                Save Communication Group
              </Button>
            </form>
          </Card>

          <div className="space-y-6">
            <Card className="p-6 space-y-4 shadow-md bg-white border">
              <h4 className="font-bold text-slate-800 flex items-center gap-2"><List size={16} /> Saved Segments</h4>
              <div className="space-y-3 max-h-96 overflow-y-auto pr-2 text-xs">
                {groups.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No communication segments saved yet.</p>
                ) : (
                  groups.map(g => (
                    <div key={g.id} className="p-3 bg-slate-50 rounded-xl border space-y-1">
                      <p className="font-bold text-slate-800">{g.name}</p>
                      <p className="text-[10px] text-slate-500">{g.description || "No description"}</p>
                      <Badge variant="info" className="text-[9px] mt-1 bg-indigo-100 text-indigo-700 border-none">{g.memberIds?.length || 0} Members</Badge>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
};


// --- MOBILE LOGBOOK SYSTEM (MOBILE FIRST) ---
const MobileLogbook = () => {
  const { eventId } = useParams();
  const { user, profile } = useAuth();
  const { allBoats, allUsers } = useGlobal();
  const { alert, confirm } = useUI();
  const navigate = useNavigate();

  const [event, setEvent] = useState<any>(null);
  const [log, setLog] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Weather and flow state
  const [temp, setTemp] = useState(15);
  const [weatherCondition, setWeatherCondition] = useState("Partly Cloudy");
  const [waterFlow, setWaterFlow] = useState("1.12m (Low Flow)");
  const [tideState, setTideState] = useState<string>("Flowing (Flood)");

  // Roster checklist states
  const [roster, setRoster] = useState<any[]>([]);

  // Post trip states
  const [newcomerPerformance, setNewcomerPerformance] = useState("");
  const [incidentsLogged, setIncidentsLogged] = useState("");
  const [tripDescription, setTripDescription] = useState("");

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!db || !eventId) return;
    setLoading(true);

    const unsubEvent = onSnapshot(doc(db, "events", eventId), (docSnap) => {
      if (docSnap.exists()) {
        const eData = { id: docSnap.id, ...docSnap.data() };
        setEvent(eData);

        // Fetch automated weather & flow
        fetch("/api/weather-flow")
          .then(res => res.json())
          .then(data => {
            if (data.weather) {
              setTemp(data.weather.temp);
              setWeatherCondition(data.weather.condition);
            }
            if (data.flow) {
              setWaterFlow(`${data.flow.level} (${data.flow.status})`);
            }
          })
          .catch(err => console.warn("API Fetch failed:", err.message));
      }
    });

    const unsubLog = onSnapshot(doc(db, "session_logs", eventId), (docSnap) => {
      if (docSnap.exists()) {
        const lData = docSnap.data();
        setLog(lData);
        setTideState(lData.environment?.tideHeight || "Flowing (Flood)");
        if (lData.status === "completed") {
          setNewcomerPerformance(lData.newcomerPerformance || "");
          setIncidentsLogged(lData.incidentsLogged || "");
          setTripDescription(lData.tripDescription || "");
        }
      }
    });

    setLoading(false);
    return () => {
      unsubEvent();
      unsubLog();
    };
  }, [eventId]);

  // Initializing roster list once event is fetched
  useEffect(() => {
    if (!event) return;

    const initialRoster = event.participants?.map((pid: string) => {
      const u = allUsers.find(userObj => userObj.uid === pid) || {};
      const reservedBoat = allBoats.find(b => b.id === event.boatId) || {};
      const emContact = {
        name: u.emergencyContactName || "TBC",
        phone: u.emergencyContactPhone || "TBC",
        relationship: u.emergencyContactRelationship || "Family"
      };

      return {
        uid: pid,
        displayName: u.displayName || u.email || "Unknown Paddler",
        role: u.role || "guest",
        onboardingStatus: u.onboardingStatus || "none",
        boatId: event.boatId || "",
        boatName: reservedBoat.name || "None",
        boatColour: reservedBoat.colour || "None",
        present: true,
        emergencyContact: emContact
      };
    }) || [];

    setRoster(initialRoster);
  }, [event, allUsers, allBoats]);

  const toggleRosterPresence = (uid: string) => {
    setRoster(prev => prev.map(p => p.uid === uid ? { ...p, present: !p.present } : p));
  };

  const updateRosterBoat = (uid: string, boatId: string) => {
    const selected = allBoats.find(b => b.id === boatId) || {};
    setRoster(prev => prev.map(p => 
      p.uid === uid ? { ...p, boatId, boatName: selected.name || "None", boatColour: selected.colour || "None" } : p
    ));
  };

  const updateRosterEmergencyContact = (uid: string, field: "name" | "phone", val: string) => {
    setRoster(prev => prev.map(p => 
      p.uid === uid ? { ...p, emergencyContact: { ...p.emergencyContact, [field]: val } } : p
    ));
  };

  const launchSession = async () => {
    if (!db || !eventId) return;
    setSaving(true);

    try {
      const logRef = doc(db, "session_logs", eventId);
      await setDoc(logRef, {
        id: eventId,
        eventId,
        title: event.title,
        date: event.date,
        leaderId: event.leaderId || user?.uid,
        leaderName: profile?.displayName || "Leader",
        status: "active",
        environment: {
          temperature: temp,
          weatherCondition,
          waterFlowThames: waterFlow,
          tideHeight: tideState
        },
        participants: roster,
        launchedAt: serverTimestamp(),
        completedAt: null
      });
      alert("🚀 Departure log completed! Session is now ACTIVE. Roster safety protocols initiated.");
    } catch (err: any) {
      alert("Failed to launch session: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const triggerEmergencyCall = (phone: string) => {
    if (phone === "TBC") {
      alert("Emergency contact phone number is missing/unconfigured!");
      return;
    }
    window.location.href = `tel:${phone}`;
  };

  const confirmSafeReturn = async () => {
    if (!db || !eventId) return;
    confirm("Confirm safe return of all checked-in paddlers? This will transition the log to the post-trip safety checklist.", async () => {
      try {
        const logRef = doc(db, "session_logs", eventId);
        await updateDoc(logRef, { status: "completed" });
      } catch (err: any) {
        alert("Return transition failed: " + err.message);
      }
    });
  };

  const closeAndSubmitFinalLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !eventId || !log) return;
    setSaving(true);

    try {
      const logRef = doc(db, "session_logs", eventId);
      await updateDoc(logRef, {
        status: "completed",
        completedAt: serverTimestamp(),
        newcomerPerformance,
        incidentsLogged,
        tripDescription
      });

      // Synchronize stats row to Supabase (Independent try-catch to prevent overall blocker)
      try {
        if (supabase) {
          const presentParticipants = log.participants.filter((p: any) => p.present);
          for (const p of presentParticipants) {
            let supBoatId: any = parseInt(p.boatId || "0");
            if (isNaN(supBoatId) || supBoatId === 0) {
              const { data: bMatch } = await supabase.from('boats').select('id').eq('firebase_id', p.boatId).maybeSingle();
              if (bMatch) supBoatId = bMatch.id;
            }
            
            await supabase.from("rentals").insert({
              user_id: p.uid,
              boat_id: supBoatId || null,
              status: "completed",
              amount: 0 // Logbook attendances have 0 cost
            });
          }
        }
      } catch (supabaseErr: any) {
        console.warn("Supabase stats sync warning:", supabaseErr.message);
      }

      // Automatically generate a Social News Snippet
      await addDoc(collection(db, "snippets"), {
        eventId,
        eventTitle: event.title,
        date: event.date,
        leaderName: log.leaderName || profile?.displayName || "Leader",
        weather: log.environment,
        summary: tripDescription,
        newcomerPerformance,
        incidentsLogged,
        paddlerCount: log.participants.filter((p: any) => p.present).length,
        boatsUsed: log.participants.filter((p: any) => p.present).map((p: any) => p.boatName).filter(Boolean),
        createdAt: serverTimestamp()
      });

      alert("🏁 Safety Log successfully closed and submitted! Session results have populated monthly newsletter drafts.");
      navigate("/dashboard/social");
    } catch (err: any) {
      alert("Failed to submit final log: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading || !event) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshCw className="animate-spin text-emerald-600" size={32} />
      </div>
    );
  }

  // --- MOBILE VIEWS RENDER ---
  return (
    <div className="max-w-md mx-auto space-y-6 py-6 px-4 animate-in fade-in duration-300">
      {/* Header Info */}
      <Card className="p-5 bg-gradient-to-br from-emerald-600 to-teal-700 text-white rounded-2xl space-y-2 border-none shadow-lg">
        <div className="flex justify-between items-start">
          <Badge className="bg-white/20 text-white border-none uppercase tracking-widest text-[9px] px-2 py-0.5">
            Logbook Safety Controller
          </Badge>
          {log ? (
            <Badge className="bg-white/30 text-white uppercase text-[9px] border-none font-bold">
              Status: {log.status}
            </Badge>
          ) : (
            <Badge className="bg-amber-400 text-slate-900 uppercase text-[9px] font-black border-none">
              Not Launched
            </Badge>
          )}
        </div>
        <h2 className="text-2xl font-black italic">{event.title}</h2>
        <p className="text-xs text-emerald-100 flex items-center gap-1">
          <Calendar size={12} /> {event.date?.toDate ? format(event.date.toDate(), "dd MMMM yyyy") : event.date}
        </p>
      </Card>

      {/* PHASE 1: PRE-TRIP (Not launched) */}
      {!log && (
        <div className="space-y-6">
          {/* Weather and Tides */}
          <Card className="p-4 space-y-3 bg-white shadow-md rounded-2xl">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">1. River Diagnostics</h3>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="text-slate-400">🌡️ Temperature</span>
                <p className="font-bold text-slate-800 text-sm mt-0.5">{temp}°C ({weatherCondition})</p>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="text-slate-400">🌊 Thames Level</span>
                <p className="font-bold text-slate-800 text-sm mt-0.5">{waterFlow}</p>
              </div>
            </div>
            
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Thames Tidal State</label>
              <select
                value={tideState}
                onChange={(e) => setTideState(e.target.value)}
                className="w-full p-2.5 border rounded-xl text-xs bg-slate-50 outline-none focus:ring-2 focus:ring-emerald-500 font-bold"
              >
                <option value="Flowing (Flood)">🌊 Flowing (Flood)</option>
                <option value="Ebbing (Ebb)">📉 Ebbing (Ebb)</option>
                <option value="High Slack">⚖️ High Slack</option>
                <option value="Low Slack">🪨 Low Slack</option>
              </select>
            </div>
          </Card>

          {/* Attendees check-in */}
          <Card className="p-4 space-y-4 bg-white shadow-md rounded-2xl">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b pb-2">
              2. Launch Safety Roster ({roster.length} paddlers)
            </h3>

            <div className="space-y-4">
              {roster.map(p => {
                const isBeginner = ["beginner_paid", "trial_active", "pending_leader_approval", "beginner_pending_payment"].includes(p.onboardingStatus);
                return (
                  <div key={p.uid} className={cn("p-3 border rounded-xl space-y-3 transition-colors", p.present ? "border-slate-100 bg-white" : "border-slate-100 bg-slate-50 opacity-60")}>
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2">
                        <input 
                          type="checkbox" 
                          checked={p.present} 
                          onChange={() => toggleRosterPresence(p.uid)}
                          className="h-5 w-5 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300"
                        />
                        <div>
                          <p className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                            {p.displayName}
                            {isBeginner && <Badge variant="destructive" className="bg-red-50 text-red-600 text-[8px] py-0 border-none font-bold">New Recruit</Badge>}
                          </p>
                          <p className="text-[10px] text-slate-400 capitalize">{p.role}</p>
                        </div>
                      </div>
                    </div>

                    {p.present && (
                      <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-slate-100">
                        {/* Boat Selector */}
                        <div className="space-y-0.5">
                          <label className="text-[9px] font-bold text-slate-400 uppercase">Boat Assigned</label>
                          <select
                            value={p.boatId}
                            onChange={(e) => updateRosterBoat(p.uid, e.target.value)}
                            className="w-full p-1 text-[11px] border rounded bg-white font-medium"
                          >
                            <option value="">None</option>
                            {allBoats.map(b => (
                              <option key={b.id} value={b.id}>{b.name} ({b.colour})</option>
                            ))}
                          </select>
                        </div>

                        {/* Emergency Contact Quick Edit */}
                        <div className="space-y-0.5">
                          <label className="text-[9px] font-bold text-slate-400 uppercase">Emergency Contact Phone</label>
                          <input 
                            type="tel"
                            value={p.emergencyContact.phone}
                            onChange={(e) => updateRosterEmergencyContact(p.uid, "phone", e.target.value)}
                            className="w-full p-1 text-[11px] border rounded bg-white text-cyan-600 font-bold"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          <Button 
            onClick={launchSession} 
            disabled={saving || roster.length === 0} 
            className="w-full h-14 text-lg font-black bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl shadow-xl shadow-emerald-200"
          >
            {saving ? <RefreshCw className="animate-spin mr-2" /> : <Zap className="mr-2" />}
            Launch active paddle 🚀
          </Button>
        </div>
      )}

      {/* PHASE 2: ACTIVE SESSION (Emergency Call list) */}
      {log && log.status === "active" && (
        <div className="space-y-6">
          <Card className="p-4 bg-amber-50 border border-amber-100 rounded-2xl flex items-center gap-3">
            <ShieldAlert className="text-amber-600 shrink-0" size={24} />
            <div className="text-xs text-amber-800">
              <p className="font-bold">Active Safety Protocols Initiated.</p>
              <p>One-tap dialing is activated for all present participant emergency contacts.</p>
            </div>
          </Card>

          <Card className="p-4 space-y-4 bg-white shadow-md rounded-2xl">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b pb-2">
              🚨 Active Water Roster ({log.participants?.filter((p: any) => p.present).length} paddlers)
            </h3>

            <div className="space-y-3">
              {log.participants?.filter((p: any) => p.present).map((p: any) => (
                <div key={p.uid} className="p-3 border border-slate-100 rounded-xl flex justify-between items-center bg-slate-50/50">
                  <div className="space-y-1">
                    <p className="font-bold text-slate-800 text-sm flex items-center gap-2">
                      {p.displayName}
                      {p.boatName && <span className="text-[10px] text-cyan-600 font-bold">🛶 {p.boatName} ({p.boatColour})</span>}
                    </p>
                    <p className="text-[10px] text-slate-400">Emergency: {p.emergencyContact.name} ({p.emergencyContact.relationship})</p>
                  </div>
                  <button 
                    onClick={() => triggerEmergencyCall(p.emergencyContact.phone)}
                    className="p-3 bg-red-50 text-red-600 hover:bg-red-100 rounded-full transition-colors border border-red-100"
                  >
                    <PhoneCall size={18} />
                  </button>
                </div>
              ))}
            </div>
          </Card>

          <Button 
            onClick={confirmSafeReturn} 
            className="w-full h-14 text-lg font-black bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl shadow-xl shadow-indigo-100"
          >
            Confirm Safe Return of All 🏁
          </Button>
        </div>
      )}

      {/* PHASE 3: POST-TRIP (Completing Trip Form) */}
      {log && log.status === "completed" && (
        <Card className="p-6 bg-white shadow-lg rounded-2xl border border-slate-100 space-y-6">
          <div>
            <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
              🏁 Safe Return Logbook Closeout
            </h3>
            <p className="text-xs text-slate-500">Provide narrative details to auto-populate the monthly social newsletter.</p>
          </div>

          <form onSubmit={closeAndSubmitFinalLog} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-400">Trip Narrative / Highlights</label>
              <textarea 
                required
                value={tripDescription}
                onChange={(e) => setTripDescription(e.target.value)}
                placeholder="Where did we paddle? Spot any Thames seals? Highlight safe returns..."
                className="w-full h-32 p-3 border rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-400">New Recruit Performance (Beginners/Trial)</label>
              <textarea 
                required
                value={newcomerPerformance}
                onChange={(e) => setNewcomerPerformance(e.target.value)}
                placeholder="Detail how beginners fared on the tide. Mention if any issues were resolved..."
                className="w-full h-24 p-3 border rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-400">Outstanding Safety/Equipment Incidents</label>
              <textarea 
                value={incidentsLogged}
                onChange={(e) => setIncidentsLogged(e.target.value)}
                placeholder="Log any boat damages, close-calls, or weather delay details..."
                className="w-full h-20 p-3 border rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
              />
            </div>

            <Button 
              type="submit" 
              disabled={saving} 
              className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
            >
              {saving ? <RefreshCw className="animate-spin mr-2" /> : <CheckCircle2 className="mr-2" />}
              Close & Submit Event Logbook 💾
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
};


const FeedbackManagement = () => {
  const { confirm } = useUI();
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "feedback"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (s) => {
      setFeedback(s.docs.map(d => ({ id: d.id, ...d.data() } as FeedbackItem)));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "feedback");
    });
    return unsub;
  }, []);

  const toggleStatus = async (item: FeedbackItem) => {
    if (!item.id) return;
    try {
      if (db) {
        await updateDoc(doc(db, "feedback", item.id), {
          isCompleted: !item.isCompleted,
          updatedAt: serverTimestamp()
        });
      }
    } catch (e: any) {
      handleFirestoreError(e, OperationType.UPDATE, `feedback/${item.id}`);
    }
  };

  const saveNote = async (id: string, note: string) => {
    try {
      if (db) {
        await updateDoc(doc(db, "feedback", id), {
          adminNote: note,
          updatedAt: serverTimestamp()
        });
      }
    } catch (e: any) {
      handleFirestoreError(e, OperationType.UPDATE, `feedback/${id}`);
    }
  };

  if (loading) return <div className="flex justify-center p-8"><RefreshCw className="animate-spin text-emerald-600" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-xl font-black italic uppercase tracking-tight text-slate-900 leading-none">Feedback & <span className="text-emerald-600">Tasks</span></h3>
          <p className="text-slate-500 text-sm mt-1">Managed collaboration list for site improvements.</p>
        </div>
        <Badge variant="secondary" className="px-3 py-1 font-mono">{feedback.length} ITEMS</Badge>
      </div>

      <div className="space-y-4">
        {feedback.length === 0 ? (
          <div className="text-center py-24 bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200">
            <MessageSquare className="mx-auto text-slate-300 mb-4" size={48} />
            <p className="text-slate-500 font-bold font-mono text-sm uppercase tracking-widest">No feedback received yet</p>
          </div>
        ) : (
          feedback.map((item) => (
            <Card key={item.id} className={cn("p-6 transition-all border-l-4", 
              item.isCompleted ? "opacity-60 bg-slate-50 border-l-slate-300 shadow-none" : 
              item.type === "Correction" ? "border-l-amber-500 shadow-sm" : "border-l-emerald-500 shadow-sm"
            )}>
              <div className="flex items-start justify-between gap-6">
                <div className="flex-1 space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant={item.type === "Correction" ? "warning" : "success"} className="rounded-md font-black uppercase text-[10px] tracking-widest">{item.type}</Badge>
                    <h4 className="font-black text-slate-900 text-lg leading-none">
                      {item.type === "Correction" ? `${item.page}` : "New Idea Suggestion"}
                    </h4>
                    {item.isCompleted && <Badge variant="success" className="flex items-center gap-1 font-mono uppercase text-[10px]"><Check size={12} /> DONE</Badge>}
                  </div>

                  {item.type === "Correction" ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden group">
                      <div className="space-y-2 relative z-10">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">Current Version</span>
                        <div className="text-sm bg-red-50/50 text-red-700 p-3 rounded-xl font-medium border border-red-100 min-h-[60px] italic">
                          "{item.currentText}"
                        </div>
                      </div>
                      <div className="space-y-2 relative z-10">
                        <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600 block">Requested Correction</span>
                        <div className="text-sm bg-emerald-50 text-emerald-700 p-3 rounded-xl font-bold border border-emerald-100 min-h-[60px]">
                          "{item.suggestedText}"
                        </div>
                      </div>
                      {item.locationOnPage && (
                        <div className="col-span-2 flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest pt-2 border-t border-slate-50">
                          <MapPin size={12} className="text-slate-300" />
                          Location: <span className="text-slate-600">{item.locationOnPage}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
                       <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-2">Detailed Idea</span>
                       <p className="text-sm text-slate-800 leading-relaxed font-medium whitespace-pre-wrap">{item.description}</p>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-6 text-[10px] font-black uppercase tracking-widest text-slate-400 pt-4 border-t border-slate-100">
                    <span className="flex items-center gap-1.5"><Users size={12} className="text-slate-300" /> From: <span className="text-slate-900">{item.submitterName}</span></span>
                    <span className="flex items-center gap-1.5"><Calendar size={12} className="text-slate-300" /> Date: <span className="text-slate-900">{format(item.createdAt?.toDate ? item.createdAt.toDate() : new Date(item.createdAt), "MMM do, HH:mm")}</span></span>
                  </div>

                  <div className="space-y-2 pt-2 group">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-focus-within:text-emerald-600 transition-colors">Admin Progress Notes</label>
                    <textarea 
                      className="w-full p-4 border-2 border-slate-100 rounded-2xl bg-slate-50/30 outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500/50 transition-all text-sm font-medium min-h-[80px] shadow-inner"
                      placeholder="Add a note (e.g. 'In progress', 'Fixed on dev branch', etc.)"
                      defaultValue={item.adminNote}
                      onBlur={(e) => saveNote(item.id!, e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <button 
                    onClick={() => toggleStatus(item)}
                    className={cn(
                      "p-4 rounded-2xl transition-all shadow-lg active:scale-95 group",
                      item.isCompleted 
                        ? "bg-emerald-600 text-white ring-4 ring-emerald-500/20" 
                        : "bg-white text-slate-400 border-2 border-slate-100 hover:border-emerald-500 hover:text-emerald-500 hover:shadow-emerald-500/10"
                    )}
                  >
                    <CheckCircle2 size={32} className={cn("transition-transform", !item.isCompleted && "group-hover:scale-110")} />
                  </button>
                  <button 
                    onClick={() => {
                      confirm("Are you 100% sure you want to permanently delete this task record?", async () => {
                         if (db) await deleteDoc(doc(db, "feedback", item.id!));
                      });
                    }}
                    className="p-4 bg-white text-slate-400 border-2 border-slate-100 rounded-2xl hover:border-red-500 hover:text-red-500 transition-all shadow-md active:scale-95"
                  >
                    <Trash2 size={24} />
                  </button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
};

const AdminDashboard = () => {
  const { user, profile } = useAuth();
  const { allUsers: users, visibility: globalVisibility } = useGlobal();
  const { confirm, alert } = useUI();
  const [docs, setDocs] = useState<any[]>([]);
  const [showAddMember, setShowAddMember] = useState(false);
  const [activeTab, setActiveTab] = useState<"users" | "signup_list" | "feedback" | "visibility" | "import" | "statistics">("users");
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "name" | "status">("newest");

  const sortedUsers = useMemo(() => {
    let list = [...users];
    
    // Search logic
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      list = list.filter(u => 
        (u.displayName || "").toLowerCase().includes(s) || 
        (u.email || "").toLowerCase().includes(s) ||
        (u.firstName || "").toLowerCase().includes(s) ||
        (u.lastName || "").toLowerCase().includes(s) ||
        (u.memberNumber || "").toLowerCase().includes(s)
      );
    }

    // Sort logic
    list.sort((a, b) => {
      if (sortOrder === "newest") {
        const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt ? (typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : 0) : 0);
        const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt ? (typeof b.createdAt === 'string' ? new Date(b.createdAt).getTime() : 0) : 0);
        // Fallback to 0 if both are 0, or place 0 at the end
        if (timeA === 0 && timeB !== 0) return 1;
        if (timeB === 0 && timeA !== 0) return -1;
        return timeB - timeA;
      }
      if (sortOrder === "name") {
        return (a.displayName || "").localeCompare(b.displayName || "");
      }
      if (sortOrder === "status") {
        return (a.onboardingStatus || "").localeCompare(b.onboardingStatus || "");
      }
      return 0;
    });

    return list;
  }, [users, searchTerm, sortOrder]);

  const visibility = useMemo(() => {
    return globalVisibility || {};
  }, [globalVisibility]);

  useEffect(() => {
    if (!user || !profile || profile.role !== "admin") return;
    
        const unsubDocs = onSnapshot(collection(db, "documents"), (s) => {
          setDocs(s.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        
        console.log("[AdminDashboard] Subscribed to users and documents. Total users:", users.length);
    
    return () => { unsubDocs(); };
  }, [user, profile]);

  const updateVisibility = async (role: string, field: string, checked: boolean) => {
    if (!visibility) return;
    const currentFields = visibility[role] || [];
    const newFields = checked 
      ? [...currentFields, field]
      : currentFields.filter((f: string) => f !== field);
    
    try {
      await updateDoc(doc(db, "settings", "visibility"), {
        [role]: newFields
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, "settings/visibility");
    }
  };

  const handleImport = async (data: string) => {
    const headerMapping: { [key: string]: string } = {
      "First name": "firstName",
      "Last name": "lastName",
      "Email": "email",
      "Email 2 (mailing list only)": "email2",
      "Membership": "membershipType",
      "Year of birth": "yearOfBirth",
      "Sex": "sex",
      "Contact number (landline)": "landlineNumber",
      "Mobile number": "mobileNumber",
      "House name/number and street": "houseNameNumberStreet",
      "Town": "town",
      "County": "county",
      "Postcode": "postcode",
      "Member number": "memberNumber",
      "Details of disability or long term illness": "disabilityDetails",
      "Emergency contact name:": "emergencyContactName",
      "Emergency contact phone number": "emergencyContactPhone",
      "Emergency contact relationship": "emergencyContactRelationship",
      "Number of years you have been paddling": "yearsPaddling",
      "British Canoeing Personal Awards": "britishCanoeingAwards",
      "British Canoeing Coaching qualifications": "britishCanoeingQualifications",
      "British Canoeing member": "britishCanoeingMember",
      "Lee Valley Assessment": "leeValleyAssessment",
      "First aid & Safeguarding qualifications": "firstAidSafeguarding",
      "Navigation qualifications": "navigationQualifications",
      "Kayaking leadership and organisational experience": "kayakingLeadershipExperience",
      "Non-kayaking leadership experience": "nonKayakingLeadershipExperience",
      "Training": "training",
      "Experience": "experience",
      "Newsletter": "newsletter",
      "Interested in Sea Kayaking?": "interestedInSeaKayaking",
      "Interested in racing in (less stable) K1/K2 race boats?": "interestedInRacing",
      "Racing division": "racingDivision",
      "Include me in the member directory": "includeInDirectory",
      "Photo": "photoUrl",
      "Key holder": "keyHolder",
      "Committee member": "committeeMember",
      "BoatStorage": "boatStorage",
      "Exclude from special mail list": "excludeFromSpecialMailList",
      "Thames Leader": "thamesLeader",
      "Leader Training": "leaderTraining",
      "How did you hear about us?": "howDidYouHear",
      "Expires on": "expiresOn",
      "System email": "systemEmail",
      "Renewed on": "renewedOn",
      "Member since": "memberSince",
      "Memb": "memberSince",
      "Site role": "role",
      "Linked To": "linkedTo",
      "Membership state": "membershipState",
      "Unsubscribe expiry email": "unsubscribeExpiryEmail",
      "Unsubscribe group email": "unsubscribeGroupEmail"
    };

    try {
      const lines = data.trim().split("\n").filter(line => line.trim() !== "");
      if (lines.length < 2) {
        alert("Please provide at least a header row and one data row.");
        return;
      }

      // Detect delimiter: tab or comma
      const firstLine = lines[0];
      const delimiter = firstLine.includes("\t") ? "\t" : ",";
      
      const rows = lines.map(r => r.split(delimiter).map(c => c.trim().replace(/^"|"$/g, "")));
      const headers = rows[0];
      const items = rows.slice(1);

      let importedCount = 0;
      let errorCount = 0;
      const errors: string[] = [];

      for (const item of items) {
        if (item.length < 2) continue; // Skip empty or malformed rows
        
        const profile: any = {};
        headers.forEach((h, i) => {
          const key = headerMapping[h.trim()] || h.trim();
          let val: any = item[i];
          if (val === undefined) return;
          
          const upperVal = val.toString().toUpperCase();
          if (upperVal === "TRUE" || upperVal === "YES") val = true;
          else if (upperVal === "FALSE" || upperVal === "NO") val = false;
          else if (!isNaN(Number(val)) && val !== "" && !val.toString().startsWith("0")) val = Number(val);
          
          profile[key] = val;
        });

        if (profile.email) {
          try {
            const tempId = `imported_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            // Handle date fields
            const dateFields = ["expiresOn", "renewedOn", "memberSince", "poolApprovalDate", "createdAt"];
            dateFields.forEach(field => {
              if (profile[field] && typeof profile[field] === "string") {
                const d = new Date(profile[field]);
                if (!isNaN(d.getTime())) {
                  profile[field] = d;
                }
              }
            });

            // Normalize role and status
            if (profile.role) {
              const role = profile.role.toString().toLowerCase();
              const validRoles = ['guest', 'future_member', 'member', 'leader', 'instructor', 'financial', 'social', 'admin'];
              if (validRoles.includes(role)) profile.role = role;
            }
            
            if (profile.onboardingStatus) {
              const status = profile.onboardingStatus.toString().toLowerCase().replace(/ /g, "_");
              const validStatuses = ['none', 'invited', 'beginner_pending_payment', 'beginner_paid', 'pro_pending_approval', 'former_pending_payment', 'pool_passed', 'membership_paid'];
              if (validStatuses.includes(status)) profile.onboardingStatus = status;
            }

            await setDoc(doc(db, "users", tempId), {
              ...profile,
              uid: tempId,
              displayName: profile.displayName || `${profile.firstName || ""} ${profile.lastName || ""}`.trim() || profile.email,
              role: profile.role || "member",
              onboardingStatus: profile.onboardingStatus || "membership_paid",
              memberSince: profile.memberSince || serverTimestamp(),
              isImported: true
            });
            importedCount++;
          } catch (e: any) {
            errorCount++;
            errors.push(`${profile.email}: ${e.message}`);
            console.error(`Error importing ${profile.email}:`, e);
          }
        }
      }
      
      let message = `Imported ${importedCount} users successfully.`;
      if (errorCount > 0) {
        message += `\nFailed to import ${errorCount} users. Check console for details.`;
        if (errors.length <= 5) {
          message += `\nErrors:\n${errors.join("\n")}`;
        }
      }
      alert(message);
    } catch (error) {
      console.error("Import error:", error);
      alert(`Failed to import data: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const updateRole = async (uid: string, role: Role) => {
    try {
      if (db) await updateDoc(doc(db, "users", uid), { role });
    syncProfileToSupabase(uid, { role });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
    }
  };

  const addDocLink = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    try {
      await addDoc(collection(db, "documents"), {
        title: formData.get("title"),
        url: formData.get("url"),
        category: formData.get("category")
      });
      e.currentTarget.reset();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, "documents");
    }
  };

  const handleAddMember = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const displayName = formData.get("displayName") as string;
    
    try {
      // In a real app, we'd use an invitation system. 
      // For this demo, we'll create a placeholder user profile.
      const tempId = `manual_${Date.now()}`;
      await setDoc(doc(db, "users", tempId), {
        uid: tempId,
        email,
        displayName,
        role: "member",
        onboardingStatus: "membership_paid",
        memberSince: serverTimestamp(),
        createdAt: serverTimestamp(),
        isManualEntry: true
      });
      setShowAddMember(false);
      alert("Member added to management list.");
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, "users");
    }
  };

  return (
    <div className="space-y-12 py-8">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold">Administrator Panel</h2>
        <Button onClick={() => setShowAddMember(true)} className="flex items-center gap-2">
          <Plus size={18} /> Add Existing Member
        </Button>
      </div>

      <div className="flex border-b border-slate-200">
        <button 
          onClick={() => setActiveTab("users")}
          className={cn("px-6 py-3 text-sm font-bold transition-colors border-b-2", activeTab === "users" ? "border-slate-900 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600")}
        >
          User Management
        </button>
        <button 
          onClick={() => setActiveTab("signup_list")}
          className={cn("px-6 py-3 text-sm font-bold transition-colors border-b-2", activeTab === "signup_list" ? "border-slate-900 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600")}
        >
          Master Signup List
        </button>
        <button 
          onClick={() => setActiveTab("visibility")}
          className={cn("px-6 py-3 text-sm font-bold transition-colors border-b-2", activeTab === "visibility" ? "border-slate-900 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600")}
        >
          Visibility Settings
        </button>
        <button 
          onClick={() => setActiveTab("feedback")}
          className={cn("px-6 py-3 text-sm font-bold transition-colors border-b-2", activeTab === "feedback" ? "border-slate-900 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600")}
        >
          Feedback & Tasks
        </button>
        <button 
          onClick={() => setActiveTab("import")}
          className={cn("px-6 py-3 text-sm font-bold transition-colors border-b-2", activeTab === "import" ? "border-slate-900 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600")}
        >
          Import Data
        </button>
        <button 
          onClick={() => setActiveTab("statistics")}
          className={cn("px-6 py-3 text-sm font-bold transition-colors border-b-2 whitespace-nowrap", activeTab === "statistics" ? "border-slate-900 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600")}
        >
          Analytics & Rankings
        </button>
      </div>

      {showAddMember && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="p-6 max-w-md w-full space-y-4">
            <h3 className="text-xl font-bold">Add Existing Member</h3>
            <form onSubmit={handleAddMember} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Full Name</label>
                <input name="displayName" required className="w-full p-2 border rounded-lg" placeholder="John Doe" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Email Address</label>
                <input name="email" type="email" required className="w-full p-2 border rounded-lg" placeholder="john@example.com" />
              </div>
              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setShowAddMember(false)}>Cancel</Button>
                <Button type="submit" className="flex-1">Add Member</Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {activeTab === "users" && (
        <div className="grid lg:grid-cols-3 gap-8">
          <section className="lg:col-span-2 space-y-4">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <h3 className="text-xl font-bold flex items-center gap-2 text-slate-800"><Users size={20} /> User Management</h3>
              <div className="flex items-center gap-3 w-full md:w-auto">
                <div className="relative flex-1 md:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input 
                    type="text" 
                    placeholder="Search by name or email..." 
                    className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-slate-900 outline-none"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <Badge variant="default" className="text-xs shrink-0">{users.length} Total Users</Badge>
              </div>
              <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Sort:</span>
                  <select 
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value as any)}
                    className="text-xs border border-slate-200 rounded-lg p-1 px-2 bg-white shadow-sm focus:ring-2 focus:ring-slate-500 outline-none"
                  >
                    <option value="newest">Newest First</option>
                    <option value="name">Name</option>
                    <option value="status">Status</option>
                  </select>
                </div>
            </div>
            <Card className="overflow-x-auto shadow-xl border-slate-100">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="p-4 text-sm font-bold text-slate-600">User</th>
                    <th className="p-4 text-sm font-bold text-slate-600">Status & Expiry</th>
                    <th className="p-4 text-sm font-bold text-slate-600">Member #</th>
                    <th className="p-4 text-sm font-bold text-slate-600">Role</th>
                    <th className="p-4 text-sm font-bold text-slate-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {sortedUsers.map((u, userIdx) => (
                    <tr key={u.uid || `user-${userIdx}`} className="hover:bg-slate-50/50 transition-colors">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-sm uppercase border border-slate-200">
                            {u.displayName?.substring(0, 2) || "??"}
                          </div>
                          <div>
                            <p className="font-bold text-slate-900 text-sm">{u.displayName}</p>
                            <p className="text-[10px] text-slate-500">{u.email}</p>
                            <p className="text-[9px] text-slate-400 italic">{u.town || "No town"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="space-y-1">
                          <Badge variant={u.onboardingStatus === "membership_paid" ? "success" : "warning"} className="text-[9px]">
                            {u.onboardingStatus?.replace("_", " ") || "guest"}
                          </Badge>
                          {u.expiresOn && (
                            <p className="text-[9px] text-slate-400">
                              Exp: {format(u.expiresOn.toDate ? u.expiresOn.toDate() : new Date(u.expiresOn), "MMM d, yyyy")}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="p-4">
                        <p className="text-xs font-mono text-slate-600">{u.memberNumber || "---"}</p>
                      </td>
                      <td className="p-4">
                        <select 
                          value={u.role}
                          onChange={(e) => updateRole(u.uid, e.target.value as Role)}
                          className="text-xs border border-slate-200 rounded-lg p-1.5 bg-white shadow-sm focus:ring-2 focus:ring-slate-500 outline-none"
                        >
                          <option value="guest">Guest</option>
                          <option value="future_member">Future Member</option>
                          <option value="member">Member</option>
                          <option value="partner_club">Partner Club</option>
                          <option value="leader">Leader</option>
                          <option value="instructor">Instructor</option>
                          <option value="financial">Finance</option>
                          <option value="social">Social</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td className="p-4">
                        <div className="flex gap-1">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600"
                            onClick={() => setEditingUser(u)}
                          >
                            <Edit size={14} />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-8 w-8 p-0 text-slate-400 hover:text-red-600 cursor-pointer"
                            onClick={async (e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              console.log("[User Management] Delete clicked for:", u.uid, u.displayName);
                              if (!u.uid) {
                                alert("Cannot delete user: Missing ID. Try refreshing.");
                                return;
                              }
                              confirm(`Are you sure you want to remove ${u.displayName}? This will also delete their profile data from the database. Note: The login account remains in Firebase Auth.`, async () => {
                                try {
                                  console.log("[User Management] Proceeding with deletion...");
                                  await deleteDoc(doc(db, "users", u.uid));
                                  await deleteProfileFromSupabase(u.uid!);
                                  alert(`Successfully removed ${u.displayName}.`);
                                } catch (error) {
                                  console.error("[User Management] Delete error:", error);
                                  handleFirestoreError(error, OperationType.DELETE, `users/${u.uid}`);
                                }
                              });
                            }}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>

          <section className="space-y-8">
            <Card className="p-6 space-y-4 border-slate-900 bg-slate-900 text-white shadow-2xl">
              <h3 className="text-xl font-bold flex items-center gap-2"><Shield size={20} className="text-slate-400" /> Grant Access</h3>
              <p className="text-xs text-slate-400">Invite a new member or administrator by their email address. They will be granted the selected role upon their first login.</p>
              <form onSubmit={async (e) => {
                e.preventDefault();
                const form = e.target as HTMLFormElement;
                const email = (form.elements.namedItem("email") as HTMLInputElement).value;
                const role = (form.elements.namedItem("role") as HTMLSelectElement).value;
                const name = (form.elements.namedItem("name") as HTMLInputElement).value;

                try {
                  const tempId = `invite_${Date.now()}`;
                  await setDoc(doc(db, "users", tempId), {
                    uid: tempId,
                    email,
                    displayName: name,
                    role,
                    onboardingStatus: "invited",
                    createdAt: serverTimestamp(),
                    memberNumber: `INV-${Math.floor(1000 + Math.random() * 9000)}`
                  });
                  alert(`Access granted to ${email} as ${role}.`);
                  form.reset();
                } catch (error) {
                  handleFirestoreError(error, OperationType.CREATE, "users");
                }
              }} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Full Name</label>
                  <input name="name" type="text" required className="w-full bg-slate-800 border-none rounded-lg p-3 text-sm focus:ring-2 focus:ring-slate-400 outline-none" placeholder="e.g. Frank Norell" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Email Address</label>
                  <input name="email" type="email" required className="w-full bg-slate-800 border-none rounded-lg p-3 text-sm focus:ring-2 focus:ring-slate-400 outline-none" placeholder="franknorell@gmail.com" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Initial Role</label>
                  <select name="role" required className="w-full bg-slate-800 border-none rounded-lg p-3 text-sm focus:ring-2 focus:ring-slate-400 outline-none">
                    <option value="member">Member</option>
                    <option value="partner_club">Partner Club</option>
                    <option value="leader">Leader</option>
                    <option value="instructor">Instructor</option>
                    <option value="financial">Finance</option>
                    <option value="social">Social</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <Button type="submit" className="w-full bg-white text-slate-900 hover:bg-slate-200 font-bold py-3 mt-2">
                  Grant Access
                </Button>
              </form>
            </Card>

            <Card className="p-6 space-y-4 shadow-xl border-slate-100">
              <h3 className="text-xl font-bold flex items-center gap-2 text-slate-800"><FileText size={20} /> Club Documents</h3>
              <form onSubmit={addDocLink} className="space-y-3">
                <input name="title" placeholder="Doc Title" required className="w-full p-2 border rounded-lg text-sm" />
                <input name="url" placeholder="URL (e.g. Google Drive)" required className="w-full p-2 border rounded-lg text-sm" />
                <select name="category" className="w-full p-2 border rounded-lg text-sm">
                  <option value="safety">Safety</option>
                  <option value="policy">Policy</option>
                  <option value="training">Training</option>
                </select>
                <Button type="submit" size="sm" className="w-full">Add Document</Button>
              </form>
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                {docs.map((d, docIdx) => (
                  <div key={d.id || `doc-${docIdx}`} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <div className="flex items-center gap-3">
                      <FileText size={16} className="text-slate-400" />
                      <span className="text-sm font-medium truncate max-w-[150px]">{d.title}</span>
                    </div>
                    <a href={d.url} target="_blank" className="text-xs text-emerald-600 hover:underline font-bold">View</a>
                  </div>
                ))}
              </div>
            </Card>
          </section>
        </div>
      )}

      {activeTab === "signup_list" && (
        <Card className="p-6 overflow-x-auto">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-bold">Master Signup List</h3>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => {
                const headers = [
                  "First name", "Last name", "Email", "Email 2 (mailing list only)", "Membership", "Year of birth", "Sex", 
                  "Contact number (landline)", "Mobile number", "House name/number and street", "Town", "County", "Postcode", 
                  "Member number", "Details of disability or long term illness", "Emergency contact name:", "Emergency contact phone number", 
                  "Emergency contact relationship", "Number of years you have been paddling", "British Canoeing Personal Awards", 
                  "British Canoeing Coaching qualifications", "British Canoeing member", "Lee Valley Assessment", 
                  "First aid & Safeguarding qualifications", "Navigation qualifications", "Kayaking leadership and organisational experience", 
                  "Non-kayaking leadership experience", "Training", "Experience", "Newsletter", "Interested in Sea Kayaking?", 
                  "Interested in racing in (less stable) K1/K2 race boats?", "Racing division", "Include me in the member directory", 
                  "Photo", "Key holder", "Committee member", "BoatStorage", "Exclude from special mail list", "Thames Leader", 
                  "Leader Training", "How did you hear about us?", "Expires on", "System email", "Renewed on", "Member since", 
                  "Site role", "Linked To", "Membership state", "Unsubscribe expiry email", "Unsubscribe group email"
                ];
                const rows = users.map(u => [
                  u.firstName || "",
                  u.lastName || "",
                  u.email || "",
                  u.email2 || "",
                  u.membershipType || "",
                  u.yearOfBirth || "",
                  u.sex || "",
                  u.landlineNumber || "",
                  u.mobileNumber || "",
                  u.houseNameNumberStreet || "",
                  u.town || "",
                  u.county || "",
                  u.postcode || "",
                  u.memberNumber || "",
                  u.disabilityDetails || "",
                  u.emergencyContactName || "",
                  u.emergencyContactPhone || "",
                  u.emergencyContactRelationship || "",
                  u.yearsPaddling || "",
                  u.britishCanoeingAwards || "",
                  u.britishCanoeingQualifications || "",
                  u.britishCanoeingMember ? "Yes" : "No",
                  u.leeValleyAssessment || "",
                  u.firstAidSafeguarding || "",
                  u.navigationQualifications || "",
                  u.kayakingLeadershipExperience || "",
                  u.nonKayakingLeadershipExperience || "",
                  u.training || "",
                  u.experience || "",
                  u.newsletter ? "Yes" : "No",
                  u.interestedInSeaKayaking ? "Yes" : "No",
                  u.interestedInRacing ? "Yes" : "No",
                  u.racingDivision || "",
                  u.includeInDirectory ? "Yes" : "No",
                  u.photoUrl || "",
                  u.keyHolder ? "Yes" : "No",
                  u.committeeMember ? "Yes" : "No",
                  u.boatStorage || "",
                  u.excludeFromSpecialMailList ? "Yes" : "No",
                  u.thamesLeader ? "Yes" : "No",
                  u.leaderTraining ? "Yes" : "No",
                  u.howDidYouHear || "",
                  u.expiresOn?.toDate ? format(u.expiresOn.toDate(), "yyyy-MM-dd") : (u.expiresOn || ""),
                  u.systemEmail || "",
                  u.renewedOn?.toDate ? format(u.renewedOn.toDate(), "yyyy-MM-dd") : (u.renewedOn || ""),
                  u.memberSince?.toDate ? format(u.memberSince.toDate(), "yyyy-MM-dd") : (u.memberSince || ""),
                  u.role || "",
                  u.linkedTo || "",
                  u.membershipState || "",
                  u.unsubscribeExpiryEmail ? "Yes" : "No",
                  u.unsubscribeGroupEmail ? "Yes" : "No"
                ]);
                const csvContent = [headers, ...rows].map(e => e.map(val => `"${val}"`).join(",")).join("\n");
                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement("a");
                const url = URL.createObjectURL(blob);
                link.setAttribute("href", url);
                link.setAttribute("download", `pbcc_master_list_${format(new Date(), "yyyy-MM-dd")}.csv`);
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}
            >
              Export CSV
            </Button>
          </div>
          <table className="w-full text-left text-[10px]">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="p-2 font-bold min-w-[100px]">First Name</th>
                <th className="p-2 font-bold min-w-[100px]">Last Name</th>
                <th className="p-2 font-bold min-w-[150px]">Email</th>
                <th className="p-2 font-bold">Membership</th>
                <th className="p-2 font-bold">Member #</th>
                <th className="p-2 font-bold">Town</th>
                <th className="p-2 font-bold">Mobile</th>
                <th className="p-2 font-bold">BC Member</th>
                <th className="p-2 font-bold">Status</th>
                <th className="p-2 font-bold">Expires</th>
                <th className="p-2 font-bold">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sortedUsers.map((u, userIdx) => (
                <tr key={u.uid || `master-${userIdx}`} className="hover:bg-slate-50">
                  <td className="p-2 font-medium">{u.firstName || u.displayName?.split(" ")[0]}</td>
                  <td className="p-2 font-medium">{u.lastName || u.displayName?.split(" ").slice(1).join(" ")}</td>
                  <td className="p-2">{u.email}</td>
                  <td className="p-2">{u.membershipType || "---"}</td>
                  <td className="p-2 font-mono">{u.memberNumber || "---"}</td>
                  <td className="p-2">{u.town || "---"}</td>
                  <td className="p-2">{u.mobileNumber || "---"}</td>
                  <td className="p-2">{u.britishCanoeingMember ? "Yes" : "No"}</td>
                  <td className="p-2">
                    <Badge variant={u.onboardingStatus === "membership_paid" ? "success" : "warning"} className="text-[8px]">
                      {u.onboardingStatus}
                    </Badge>
                  </td>
                  <td className="p-2">{u.expiresOn?.toDate ? format(u.expiresOn.toDate(), "MMM d, yyyy") : "---"}</td>
                  <td className="p-2 uppercase text-[9px] font-bold text-slate-400">
                    {u.role === "partner_club" ? "Partner" : u.role}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {activeTab === "visibility" && (
        <Card className="p-6">
          <h3 className="text-xl font-bold mb-6">Role Visibility Settings</h3>
          <p className="text-sm text-slate-500 mb-8">Select which fields each role can see in their respective dashboards.</p>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {["leader", "financial", "social", "instructor"].map((role, i) => (
              <div key={role + i} className="space-y-4">
                <h4 className="font-bold uppercase text-xs tracking-widest text-slate-400 border-b pb-2">{role}</h4>
                <div className="space-y-2">
                  {[
                    { id: "email", label: "Email Address" },
                    { id: "email2", label: "Email 2" },
                    { id: "mobileNumber", label: "Mobile Number" },
                    { id: "landlineNumber", label: "Landline" },
                    { id: "town", label: "Town" },
                    { id: "county", label: "County" },
                    { id: "postcode", label: "Postcode" },
                    { id: "memberNumber", label: "Member Number" },
                    { id: "expiresOn", label: "Expiry Date" },
                    { id: "onboardingStatus", label: "Status" },
                    { id: "membershipType", label: "Membership Type" },
                    { id: "newsletter", label: "Newsletter Opt-in" },
                    { id: "interestedInSeaKayaking", label: "Sea Kayaking Interest" },
                    { id: "interestedInRacing", label: "Racing Interest" },
                    { id: "abilityProfile", label: "Ability Profile" },
                    { id: "training", label: "Training Info" },
                    { id: "experience", label: "Experience Info" },
                    { id: "thamesLeader", label: "Thames Leader Status" },
                    { id: "britishCanoeingAwards", label: "BC Awards" },
                    { id: "britishCanoeingQualifications", label: "BC Qualifications" },
                    { id: "leeValleyAssessment", label: "Lee Valley Assessment" },
                    { id: "firstAidSafeguarding", label: "First Aid/Safeguarding" },
                    { id: "emergencyContactName", label: "Emergency Contact Name" },
                    { id: "emergencyContactPhone", label: "Emergency Contact Phone" },
                    { id: "emergencyContactRelationship", label: "Emergency Relationship" },
                    { id: "disabilityDetails", label: "Disability Details" },
                    { id: "keyHolder", label: "Key Holder" },
                    { id: "boatStorage", label: "Boat Storage" },
                    { id: "unsubscribeExpiryEmail", label: "Unsub Expiry Email" },
                    { id: "unsubscribeGroupEmail", label: "Unsub Group Email" },
                    { id: "upload_expense", label: "Upload Expense Privilege" },
                    { id: "manual_payment", label: "Record Manual Payment Privilege" }
                  ].map(field => (
                    <label key={field.id} className="flex items-center gap-2 text-sm cursor-pointer hover:text-slate-900 transition-colors">
                      <input 
                        type="checkbox"
                        checked={visibility?.[role]?.includes(field.id)}
                        onChange={(e) => updateVisibility(role, field.id, e.target.checked)}
                        className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                      />
                      {field.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {activeTab === "import" && (
        <Card className="p-6 space-y-6">
          <div className="space-y-2">
            <h3 className="text-xl font-bold">Bulk Data Import</h3>
            <p className="text-sm text-slate-500">
              Paste CSV data below to import multiple members at once. 
              The first row must be headers matching UserProfile property names (e.g., email, displayName, role, town, mobileNumber).
            </p>
            <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-800">
              <strong>Tip:</strong> Export your Google Sheet as CSV, open it in a text editor, and paste the content here.
              <br /><br />
              <strong>Common Headers:</strong> email, displayName, firstName, lastName, town, mobileNumber, memberNumber, role, onboardingStatus, membershipType, expiresOn, britishCanoeingMember, britishCanoeingQualifications, emergencyContactName, emergencyContactPhone
            </div>
          </div>

          <textarea 
            id="import-data"
            className="w-full h-64 p-4 font-mono text-xs border rounded-xl bg-slate-50 focus:ring-2 focus:ring-slate-900 outline-none"
            placeholder="email,displayName,role,town,mobileNumber&#10;john@example.com,John Doe,member,Richmond,07700900000"
          />
          
          <Button 
            className="w-full"
            onClick={() => {
              const textarea = document.getElementById("import-data") as HTMLTextAreaElement;
              if (textarea.value) handleImport(textarea.value);
            }}
          >
            Start Import
          </Button>
        </Card>
      )}

      {activeTab === "feedback" && <FeedbackManagement />}

      {activeTab === "statistics" && <AdminStatistics />}

      {editingUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-bold">Edit User: {editingUser.displayName}</h3>
              <button onClick={() => setEditingUser(null)} className="p-1 hover:bg-slate-100 rounded-full">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              const data: Partial<UserProfile> = {
                displayName: formData.get("displayName") as string,
                email: formData.get("email") as string,
                firstName: formData.get("firstName") as string,
                lastName: formData.get("lastName") as string,
                memberNumber: formData.get("memberNumber") as string,
                town: formData.get("town") as string,
                mobileNumber: formData.get("mobileNumber") as string,
                onboardingStatus: formData.get("onboardingStatus") as OnboardingStatus,
                role: formData.get("role") as Role,
                yearOfBirth: Number(formData.get("yearOfBirth")),
                sex: formData.get("sex") as string,
                houseNameNumberStreet: formData.get("houseNameNumberStreet") as string,
                county: formData.get("county") as string,
                postcode: formData.get("postcode") as string,
                emergencyContactName: formData.get("emergencyContactName") as string,
                emergencyContactPhone: formData.get("emergencyContactPhone") as string,
                emergencyContactRelationship: formData.get("emergencyContactRelationship") as string,
                yearsPaddling: formData.get("yearsPaddling") as string,
                britishCanoeingAwards: formData.get("britishCanoeingAwards") as string,
                britishCanoeingQualifications: formData.get("britishCanoeingQualifications") as string,
                britishCanoeingMember: formData.get("britishCanoeingMember") === "on",
                leeValleyAssessment: formData.get("leeValleyAssessment") as string,
                firstAidSafeguarding: formData.get("firstAidSafeguarding") as string,
                navigationQualifications: formData.get("navigationQualifications") as string,
                kayakingLeadershipExperience: formData.get("kayakingLeadershipExperience") as string,
                nonKayakingLeadershipExperience: formData.get("nonKayakingLeadershipExperience") as string,
                training: formData.get("training") as string,
                experience: formData.get("experience") as string,
                paddlingDescription: formData.get("paddlingDescription") as string,
                newsletter: formData.get("newsletter") === "on",
                interestedInSeaKayaking: formData.get("interestedInSeaKayaking") === "on",
                interestedInRacing: formData.get("interestedInRacing") === "on",
                racingDivision: formData.get("racingDivision") as string,
                includeInDirectory: formData.get("includeInDirectory") === "on",
                excludeFromSpecialMailList: formData.get("excludeFromSpecialMailList") === "on",
                howDidYouHear: formData.get("howDidYouHear") as string,
                disabilityDetails: formData.get("disabilityDetails") as string,
                hasDisability: formData.get("hasDisability") === "on",
                keyHolder: formData.get("keyHolder") === "on",
                committeeMember: formData.get("committeeMember") === "on",
                boatStorage: formData.get("boatStorage") as string,
                thamesLeader: formData.get("thamesLeader") === "on",
                leaderTraining: formData.get("leaderTraining") === "on",
              };
              try {
                if (db) await updateDoc(doc(db, "users", editingUser.uid), data);
                if (supabase) {
                  const { error: supErr } = await supabase.from('profiles').upsert({
                    id: editingUser.uid,
                    first_name: data.firstName,
                    last_name: data.lastName,
                    display_name: `${data.firstName} ${data.lastName}`,
                    emergency_contact_name: data.emergencyContactName,
                    emergency_contact_phone: data.emergencyContactPhone,
                    emergency_contact_relationship: data.emergencyContactRelationship,
                    years_paddling: data.yearsPaddling,
                    awards: data.britishCanoeingAwards,
                    qualifications: data.britishCanoeingQualifications,
                    bc_member: data.britishCanoeingMember,
                    lee_valley_assessment: data.leeValleyAssessment,
                    first_aid_safeguarding: data.firstAidSafeguarding,
                    navigation_qualifications: data.navigationQualifications,
                    leadership_experience: data.kayakingLeadershipExperience,
                    paddling_desc: data.paddlingDescription,
                    newsletter: data.newsletter,
                    disability_details: data.disabilityDetails,
                    has_disability: data.hasDisability,
                    key_holder: data.keyHolder,
                    committee_member: data.committeeMember,
                    boat_storage: data.boatStorage,
                    thames_leader: data.thamesLeader,
                    updated_at: new Date().toISOString()
                  });
                  if (supErr) console.error("[Supabase Admin Sync]", supErr);
                }
                setEditingUser(null);
                alert("User updated successfully.");
              } catch (error) {
                handleFirestoreError(error, OperationType.UPDATE, `users/${editingUser.uid}`);
              }
            }} className="space-y-8">
              <div className="grid md:grid-cols-2 gap-6">
                {/* Basic Info */}
                <div className="space-y-4">
                  <h4 className="font-bold text-slate-900 border-b pb-1">Basic Information</h4>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-500 uppercase">Display Name</label>
                    <input name="displayName" defaultValue={editingUser.displayName} className="w-full p-2 border rounded-lg text-sm" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-500 uppercase">Email</label>
                    <input name="email" type="email" defaultValue={editingUser.email} className="w-full p-2 border rounded-lg text-sm" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-500 uppercase">First Name</label>
                      <input name="firstName" defaultValue={editingUser.firstName} className="w-full p-2 border rounded-lg text-sm" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-500 uppercase">Last Name</label>
                      <input name="lastName" defaultValue={editingUser.lastName} className="w-full p-2 border rounded-lg text-sm" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-500 uppercase">Year of Birth</label>
                      <input name="yearOfBirth" type="number" defaultValue={editingUser.yearOfBirth} className="w-full p-2 border rounded-lg text-sm" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-500 uppercase">Sex</label>
                      <select name="sex" defaultValue={editingUser.sex} className="w-full p-2 border rounded-lg text-sm">
                        <option value="">Select...</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-500 uppercase">Mobile Number</label>
                    <input name="mobileNumber" defaultValue={editingUser.mobileNumber} className="w-full p-2 border rounded-lg text-sm" />
                  </div>
                </div>

                {/* Address */}
                <div className="space-y-4">
                  <h4 className="font-bold text-slate-900 border-b pb-1">Address</h4>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-500 uppercase">Street Address</label>
                    <input name="houseNameNumberStreet" defaultValue={editingUser.houseNameNumberStreet} className="w-full p-2 border rounded-lg text-sm" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-500 uppercase">Town</label>
                    <input name="town" defaultValue={editingUser.town} className="w-full p-2 border rounded-lg text-sm" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-500 uppercase">County</label>
                      <input name="county" defaultValue={editingUser.county} className="w-full p-2 border rounded-lg text-sm" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-500 uppercase">Postcode</label>
                      <input name="postcode" defaultValue={editingUser.postcode} className="w-full p-2 border rounded-lg text-sm" />
                    </div>
                  </div>
                </div>

                {/* Membership & Status */}
                <div className="space-y-4">
                  <h4 className="font-bold text-slate-900 border-b pb-1">Membership & Status</h4>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-500 uppercase">Member Number</label>
                    <input name="memberNumber" defaultValue={editingUser.memberNumber} className="w-full p-2 border rounded-lg text-sm" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-500 uppercase">Role</label>
                    <select name="role" defaultValue={editingUser.role} className="w-full p-2 border rounded-lg text-sm">
                      <option value="guest">Guest</option>
                      <option value="future_member">Future Member</option>
                      <option value="member">Member</option>
                      <option value="partner_club">Partner Club</option>
                      <option value="leader">Leader</option>
                      <option value="instructor">Instructor</option>
                      <option value="social">Social</option>
                      <option value="financial">Finance</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-500 uppercase">Onboarding Status</label>
                    <select name="onboardingStatus" defaultValue={editingUser.onboardingStatus} className="w-full p-2 border rounded-lg text-sm">
                      <option value="none">None</option>
                      <option value="invited">Invited</option>
                      <option value="beginner_pending_payment">Beginner Pending Payment</option>
                      <option value="beginner_paid">Beginner Paid</option>
                      <option value="pro_pending_approval">Pro Pending Approval</option>
                      <option value="former_pending_payment">Former Pending Payment</option>
                      <option value="pool_passed">Pool Passed</option>
                      <option value="membership_paid">Membership Paid</option>
                    </select>
                  </div>
                </div>

                {/* Emergency Contact */}
                <div className="space-y-4">
                  <h4 className="font-bold text-slate-900 border-b pb-1">Emergency Contact</h4>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-500 uppercase">Contact Name</label>
                    <input name="emergencyContactName" defaultValue={editingUser.emergencyContactName} className="w-full p-2 border rounded-lg text-sm" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-500 uppercase">Contact Phone</label>
                    <input name="emergencyContactPhone" defaultValue={editingUser.emergencyContactPhone} className="w-full p-2 border rounded-lg text-sm" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-500 uppercase">Relationship</label>
                    <input name="emergencyContactRelationship" defaultValue={editingUser.emergencyContactRelationship} className="w-full p-2 border rounded-lg text-sm" />
                  </div>
                </div>

                {/* Paddling Info */}
                <div className="md:col-span-2 space-y-4">
                  <h4 className="font-bold text-slate-900 border-b pb-1">Paddling Information</h4>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-500 uppercase">Years Paddling</label>
                      <select name="yearsPaddling" defaultValue={editingUser.yearsPaddling} className="w-full p-2 border rounded-lg text-sm">
                        <option value="">Select...</option>
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                        <option value="4">4</option>
                        <option value="5">5</option>
                        <option value="Over 5">Over 5</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-500 uppercase">BC Member</label>
                      <div className="flex items-center gap-2 pt-2">
                        <input type="checkbox" name="britishCanoeingMember" defaultChecked={editingUser.britishCanoeingMember} className="w-4 h-4" />
                        <span className="text-sm">Active British Canoeing Member</span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-500 uppercase">BC Awards & Qualifications</label>
                    <textarea name="britishCanoeingAwards" defaultValue={editingUser.britishCanoeingAwards} className="w-full p-2 border rounded-lg text-sm h-20" placeholder="Personal awards..." />
                    <textarea name="britishCanoeingQualifications" defaultValue={editingUser.britishCanoeingQualifications} className="w-full p-2 border rounded-lg text-sm h-20" placeholder="Coaching qualifications..." />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-500 uppercase">Paddling Experience Description</label>
                    <textarea name="paddlingDescription" defaultValue={editingUser.paddlingDescription} className="w-full p-2 border rounded-lg text-sm h-24" />
                  </div>
                </div>

                {/* Admin Flags */}
                <div className="md:col-span-2 space-y-4">
                  <h4 className="font-bold text-slate-900 border-b pb-1">Admin Flags & Special Roles</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="flex items-center gap-2">
                      <input type="checkbox" name="thamesLeader" defaultChecked={editingUser.thamesLeader} className="w-4 h-4" />
                      <label className="text-sm">Thames Leader</label>
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" name="leaderTraining" defaultChecked={editingUser.leaderTraining} className="w-4 h-4" />
                      <label className="text-sm">Leader Training</label>
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" name="keyHolder" defaultChecked={editingUser.keyHolder} className="w-4 h-4" />
                      <label className="text-sm">Key Holder</label>
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" name="committeeMember" defaultChecked={editingUser.committeeMember} className="w-4 h-4" />
                      <label className="text-sm">Committee</label>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-6 border-t">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setEditingUser(null)}>Cancel</Button>
                <Button type="submit" className="flex-1">Save All Changes</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
};

// --- Editable Content Component ---
const EditableContent = ({ pageId, sectionId, defaultContent, className }: { pageId: string, sectionId: string, defaultContent: string, className?: string }) => {
  const { profile } = useAuth();
  const [content, setContent] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const isAdmin = profile?.role === "admin";

  useEffect(() => {
    const q = query(collection(db, "content"), where("pageId", "==", pageId), where("sectionId", "==", sectionId));
    return onSnapshot(q, (snap) => {
      if (!snap.empty) {
        const data = snap.docs[0].data();
        setContent(data.content);
        setEditValue(data.content);
      } else {
        setContent(defaultContent);
        setEditValue(defaultContent);
      }
    });
  }, [pageId, sectionId, defaultContent]);

  const handleSave = async () => {
    try {
      const q = query(collection(db, "content"), where("pageId", "==", pageId), where("sectionId", "==", sectionId));
      const snap = await getDoc(doc(db, "content", `${pageId}_${sectionId}`)); // Using predictable ID
      
      await setDoc(doc(db, "content", `${pageId}_${sectionId}`), {
        pageId,
        sectionId,
        content: editValue,
        lastUpdated: serverTimestamp(),
        updatedBy: profile?.uid
      });
      setIsEditing(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, "content");
    }
  };

  if (isEditing) {
    return (
      <div className="space-y-2">
        <textarea 
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          className="w-full p-3 border rounded-xl min-h-[100px] focus:ring-2 focus:ring-emerald-500 outline-none"
        />
        <div className="flex gap-2">
          <Button size="sm" onClick={handleSave}>Save</Button>
          <Button size="sm" variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("relative group p-1 -m-1 rounded-lg hover:bg-slate-50/50 transition-colors", className)}>
      <div className="whitespace-pre-wrap">{content || defaultContent}</div>
      {isAdmin && (
        <button 
          onClick={(e) => {
            e.stopPropagation();
            setIsEditing(true);
          }}
          className="absolute -top-2 -right-2 p-1.5 bg-white border border-slate-200 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-emerald-600 z-10"
          title="Edit content"
        >
          <Edit size={14} />
        </button>
      )}
    </div>
  );
};

const LinksPage = () => {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [faqs, setFaqs] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [showAddFaq, setShowAddFaq] = useState(false);

  useEffect(() => {
    const unsubFaqs = onSnapshot(query(collection(db, "faqs"), orderBy("order", "asc")), (s) => {
      setFaqs(s.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => handleFirestoreError(err, OperationType.LIST, "faqs"));
    const unsubDocs = onSnapshot(collection(db, "documents"), (s) => {
      setDocs(s.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => handleFirestoreError(err, OperationType.LIST, "documents"));
    return () => { unsubFaqs(); unsubDocs(); };
  }, []);

  const handleDelete = async (coll: string, id: string) => {
    if (confirm("Are you sure you want to delete this item?")) {
      try {
        await deleteDoc(doc(db, coll, id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `${coll}/${id}`);
      }
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-12 space-y-12">
      <div className="space-y-4">
        <h1 className="text-4xl font-bold text-slate-900">Useful Links & FAQs</h1>
        <p className="text-slate-600">Grouped resources and answers to common questions.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <Card className="p-8 space-y-6 border-slate-100 shadow-xl">
          <h3 className="text-2xl font-bold flex items-center gap-3 text-emerald-600">
            <ExternalLink size={24} /> Paddling Resources
          </h3>
          <ul className="space-y-4">
            <li>
              <a href="https://www.britishcanoeing.org.uk/" target="_blank" className="group block p-4 bg-slate-50 rounded-xl hover:bg-emerald-50 transition-colors">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">British Canoeing</span>
                  <ChevronRight size={16} className="text-slate-400 group-hover:text-emerald-500" />
                </div>
                <p className="text-xs text-slate-500 mt-1">The national governing body for canoeing and kayaking in the UK.</p>
              </a>
            </li>
            <li>
              <a href="https://www.pla.co.uk/" target="_blank" className="group block p-4 bg-slate-50 rounded-xl hover:bg-emerald-50 transition-colors">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">Port of London Authority</span>
                  <ChevronRight size={16} className="text-slate-400 group-hover:text-emerald-500" />
                </div>
                <p className="text-xs text-slate-500 mt-1">Safety information and regulations for the tidal Thames.</p>
              </a>
            </li>
            <li>
              <a href="https://www.gopaddling.info/" target="_blank" className="group block p-4 bg-slate-50 rounded-xl hover:bg-emerald-50 transition-colors">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">Go Paddling</span>
                  <ChevronRight size={16} className="text-slate-400 group-hover:text-emerald-500" />
                </div>
                <p className="text-xs text-slate-500 mt-1">Discover new places to paddle and get tips for your next adventure.</p>
              </a>
            </li>
          </ul>
        </Card>

        <Card className="p-8 space-y-6 border-slate-100 shadow-xl">
          <h3 className="text-2xl font-bold flex items-center gap-3 text-blue-600">
            <Waves size={24} /> Weather & Tides
          </h3>
          <ul className="space-y-4">
            <li>
              <a href="https://www.metoffice.gov.uk/" target="_blank" className="group block p-4 bg-slate-50 rounded-xl hover:bg-blue-50 transition-colors">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">Met Office Weather</span>
                  <ChevronRight size={16} className="text-slate-400 group-hover:text-blue-500" />
                </div>
                <p className="text-xs text-slate-500 mt-1">Accurate weather forecasts for the region.</p>
              </a>
            </li>
            <li>
              <a href="https://www.tidetimes.org.uk/" target="_blank" className="group block p-4 bg-slate-50 rounded-xl hover:bg-blue-50 transition-colors">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">Thames Tide Times</span>
                  <ChevronRight size={16} className="text-slate-400 group-hover:text-blue-500" />
                </div>
                <p className="text-xs text-slate-500 mt-1">Essential tide information for safe paddling on the Thames.</p>
              </a>
            </li>
            <li>
              <a href="https://www.windy.com/" target="_blank" className="group block p-4 bg-slate-50 rounded-xl hover:bg-blue-50 transition-colors">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">Windy.com</span>
                  <ChevronRight size={16} className="text-slate-400 group-hover:text-blue-500" />
                </div>
                <p className="text-xs text-slate-500 mt-1">Real-time wind and weather visualization.</p>
              </a>
            </li>
          </ul>
        </Card>
      </div>

      <section className="space-y-8">
        <div className="flex justify-between items-center">
          <h2 className="text-3xl font-bold text-slate-900 flex items-center gap-3"><HelpCircle size={28} className="text-emerald-500" /> Frequently Asked Questions</h2>
          {isAdmin && <Button size="sm" onClick={() => setShowAddFaq(true)}><Plus size={14} /> Add FAQ</Button>}
        </div>
        <div className="space-y-4">
          {faqs.map(faq => (
            <Accordion key={faq.id} title={faq.question}>
              <p className="text-slate-600 leading-relaxed">{faq.answer}</p>
              {isAdmin && (
                <div className="mt-4 pt-4 border-t flex justify-end">
                  <button onClick={() => handleDelete("faqs", faq.id)} className="text-red-400 hover:text-red-600 flex items-center gap-1 text-xs">
                    <Trash2 size={14} /> Delete FAQ
                  </button>
                </div>
              )}
            </Accordion>
          ))}
          {faqs.length === 0 && (
            <p className="text-center text-slate-400 italic py-12">No FAQs have been added yet.</p>
          )}
        </div>
      </section>

      {showAddFaq && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="p-6 max-w-md w-full space-y-4">
            <h3 className="text-xl font-bold">Add FAQ</h3>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await addDoc(collection(db, "faqs"), {
                  question: f.get("question"),
                  answer: f.get("answer"),
                  order: Number(f.get("order")) || 0
                });
                setShowAddFaq(false);
              } catch (err) { handleFirestoreError(err, OperationType.CREATE, "faqs"); }
            }} className="space-y-4">
              <input name="question" placeholder="Question" required className="w-full p-2 border rounded-lg" />
              <textarea name="answer" placeholder="Answer" required className="w-full p-2 border rounded-lg h-32" />
              <input name="order" type="number" placeholder="Order (0)" className="w-full p-2 border rounded-lg" />
              <div className="flex gap-2">
                <Button type="submit" className="flex-1">Add</Button>
                <Button type="button" variant="outline" onClick={() => setShowAddFaq(false)}>Cancel</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
};

const AboutUs = () => {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [faqs, setFaqs] = useState<any[]>([]);
  const [committee, setCommittee] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  
  const [showAddFaq, setShowAddFaq] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showAddReport, setShowAddReport] = useState(false);
  const [showAddDoc, setShowAddDoc] = useState(false);

  useEffect(() => {
    const unsubFaqs = onSnapshot(query(collection(db, "faqs"), orderBy("order", "asc")), (s) => {
      setFaqs(s.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => handleFirestoreError(err, OperationType.LIST, "faqs"));
    const unsubCommittee = onSnapshot(query(collection(db, "committee"), orderBy("order", "asc")), (s) => {
      setCommittee(s.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => handleFirestoreError(err, OperationType.LIST, "committee"));
    const unsubReports = onSnapshot(query(collection(db, "annual_reports"), orderBy("year", "desc")), (s) => {
      setReports(s.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => handleFirestoreError(err, OperationType.LIST, "annual_reports"));
    const unsubDocs = onSnapshot(collection(db, "documents"), (s) => {
      setDocs(s.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => handleFirestoreError(err, OperationType.LIST, "documents"));
    return () => { unsubFaqs(); unsubCommittee(); unsubReports(); unsubDocs(); };
  }, []);

  const handleDelete = async (coll: string, id: string) => {
    if (confirm("Are you sure you want to delete this item?")) {
      try {
        await deleteDoc(doc(db, coll, id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `${coll}/${id}`);
      }
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-12 space-y-16">
      {/* Intro Section */}
      <section className="space-y-6">
        <h1 className="text-5xl font-black text-slate-900 tracking-tight">About PBCC</h1>
        <EditableContent 
          pageId="about" 
          sectionId="intro" 
          defaultContent="Founded with a passion for the water, our club is a community of paddlers dedicated to exploring the rivers, lakes, and coasts of the region. Whether you're a complete beginner or a seasoned pro, we have a place for you."
          className="text-xl text-slate-600 leading-relaxed"
        />
      </section>

      {/* Mission & Community */}
      <div className="grid md:grid-cols-2 gap-8">
        <Card className="p-8 space-y-4 border-emerald-100 bg-white shadow-xl shadow-emerald-900/5">
          <h3 className="text-2xl font-bold flex items-center gap-3 text-emerald-600">
            <Anchor size={24} /> Our Mission
          </h3>
          <EditableContent 
            pageId="about" 
            sectionId="mission" 
            defaultContent="To promote the sport of kayaking in a safe, inclusive, and environmentally responsible manner. We aim to provide high-quality training, equipment, and social opportunities for all our members."
            className="text-slate-600 leading-relaxed"
          />
        </Card>
        <Card className="p-8 space-y-4 border-blue-100 bg-white shadow-xl shadow-blue-900/5">
          <h3 className="text-2xl font-bold flex items-center gap-3 text-blue-600">
            <Users size={24} /> Our Community
          </h3>
          <EditableContent 
            pageId="about" 
            sectionId="community" 
            defaultContent="With over 200 active members, our club is a vibrant hub for social interaction and skill-sharing. We host regular events, from casual evening paddles to multi-day expeditions."
            className="text-slate-600 leading-relaxed"
          />
        </Card>
      </div>

      {/* History Section */}
      <section className="space-y-8 bg-slate-900 text-white p-12 rounded-[2rem] shadow-2xl">
        <h2 className="text-3xl font-bold flex items-center gap-3"><History size={28} className="text-emerald-400" /> Our History</h2>
        <div className="space-y-6 text-slate-300 text-lg leading-relaxed">
          <EditableContent 
            pageId="about" 
            sectionId="history_1" 
            defaultContent="The club was established in 1985 by a small group of enthusiasts who wanted to share their love for the Thames. Since then, we've grown into one of the largest and most active kayaking clubs in the area."
          />
          <EditableContent 
            pageId="about" 
            sectionId="history_2" 
            defaultContent="Over the years, we've expanded our fleet, built a dedicated clubhouse, and developed a comprehensive training program that has introduced thousands of people to the joys of paddling."
          />
        </div>
      </section>

      {/* Club Documents & Governance */}
      <section className="space-y-8">
        <div className="flex justify-between items-end">
          <div className="space-y-2">
            <h2 className="text-3xl font-bold text-slate-900">Governance & Documents</h2>
            <p className="text-slate-500">Official club policies, reports, and committee information.</p>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowAddDoc(true)}><Plus size={14} /> Doc</Button>
              <Button size="sm" variant="outline" onClick={() => setShowAddReport(true)}><Plus size={14} /> Report</Button>
              <Button size="sm" variant="outline" onClick={() => setShowAddMember(true)}><Plus size={14} /> Member</Button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Accordion title="The Constitution" icon={FileText}>
            <div className="flex items-center justify-between p-4 bg-white rounded-xl border border-slate-200">
              <div className="flex items-center gap-3">
                <FileText size={20} className="text-slate-400" />
                <span className="font-medium">Club Constitution (Adopted April 2024)</span>
              </div>
              <a href="https://putneybridgecc.co.uk/docs/PBCC_Constitution_2024.pdf" target="_blank" className="text-emerald-600 font-bold hover:underline">Download PDF</a>
            </div>
          </Accordion>

          <Accordion title="CIO Trustees’ Annual Reports" icon={BarChart3}>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="py-3 px-4 font-bold text-slate-600">Year</th>
                    <th className="py-3 px-4 font-bold text-slate-600">Trustees Report</th>
                    <th className="py-3 px-4 font-bold text-slate-600">Balance Sheet</th>
                    <th className="py-3 px-4 font-bold text-slate-600">P&L</th>
                    <th className="py-3 px-4 font-bold text-slate-600">Stats</th>
                    {isAdmin && <th className="py-3 px-4 font-bold text-slate-600">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reports.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-4 px-4 font-bold text-slate-900">{r.year}</td>
                      <td className="py-4 px-4">
                        {r.trusteesReportUrl ? <a href={r.trusteesReportUrl} target="_blank" className="text-emerald-600 hover:underline text-sm">Report</a> : "---"}
                      </td>
                      <td className="py-4 px-4">
                        {r.balanceSheetUrl ? <a href={r.balanceSheetUrl} target="_blank" className="text-emerald-600 hover:underline text-sm">Sheet</a> : "---"}
                      </td>
                      <td className="py-4 px-4">
                        {r.profitAndLossUrl ? <a href={r.profitAndLossUrl} target="_blank" className="text-emerald-600 hover:underline text-sm">P&L</a> : "---"}
                      </td>
                      <td className="py-4 px-4">
                        {r.membershipStatsUrl ? <a href={r.membershipStatsUrl} target="_blank" className="text-emerald-600 hover:underline text-sm">Stats</a> : "---"}
                      </td>
                      {isAdmin && (
                        <td className="py-4 px-4">
                          <button onClick={() => handleDelete("annual_reports", r.id)} className="text-red-400 hover:text-red-600"><Trash2 size={16} /></button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {reports.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400 italic">No reports uploaded yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Accordion>

          <Accordion title="Committee and Other Officers" icon={ShieldCheck}>
            <div className="overflow-x-auto bg-white rounded-xl border border-slate-100">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Name</th>
                    <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Role</th>
                    <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Photo</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {committee.map(m => (
                    <tr key={m.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="p-4 font-bold text-slate-900">{m.name}</td>
                      <td className="p-4 text-sm text-slate-500">{m.role}</td>
                      <td className="p-4">
                        <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-white shadow-sm">
                          <img 
                            src={m.photoUrl || `https://picsum.photos/seed/${m.name}/100/100`} 
                            alt={m.name} 
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {committee.length === 0 && (
                <div className="p-8 text-center text-slate-400 italic">No committee members listed.</div>
              )}
            </div>
          </Accordion>

          <Accordion title="CIO Documents" icon={Lock}>
            <div className="grid gap-3">
              {docs.filter(d => d.category === "cio").map(d => (
                <div key={d.id} className="flex items-center justify-between p-4 bg-white rounded-xl border border-slate-200 group">
                  <div className="flex items-center gap-3">
                    <FileText size={20} className="text-slate-400" />
                    <span className="font-medium">{d.title}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <a href={d.url} target="_blank" className="text-emerald-600 font-bold hover:underline">View</a>
                    {isAdmin && <button onClick={() => handleDelete("documents", d.id)} className="text-red-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={16} /></button>}
                  </div>
                </div>
              ))}
              {docs.filter(d => d.category === "cio").length === 0 && (
                <p className="text-center text-slate-400 text-sm italic py-4">No CIO documents found.</p>
              )}
            </div>
          </Accordion>

          <Accordion title="Members Guidelines & Safety" icon={LifeBuoy}>
            <div className="grid gap-3">
              {docs.filter(d => d.category === "safety").map(d => (
                <div key={d.id} className="flex items-center justify-between p-4 bg-white rounded-xl border border-slate-200 group">
                  <div className="flex items-center gap-3">
                    <Shield size={20} className="text-slate-400" />
                    <span className="font-medium">{d.title}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <a href={d.url} target="_blank" className="text-emerald-600 font-bold hover:underline">View</a>
                    {isAdmin && <button onClick={() => handleDelete("documents", d.id)} className="text-red-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={16} /></button>}
                  </div>
                </div>
              ))}
            </div>
          </Accordion>

          <Accordion title="Disclaimer & Fees" icon={CreditCard}>
            <div className="space-y-4">
              <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-2">
                <h4 className="font-bold text-slate-900">Membership Disclaimer</h4>
                <p className="text-sm text-slate-600">All members must agree to the club disclaimer during onboarding. A copy is available below for reference.</p>
                <a href="#" className="inline-block text-emerald-600 font-bold hover:underline text-sm">View Disclaimer PDF</a>
              </div>
              <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-2">
                <h4 className="font-bold text-slate-900">Fees [2026]</h4>
                <p className="text-sm text-slate-600">Current rates for membership, pool sessions, and kit hire.</p>
                <a href="#" className="inline-block text-emerald-600 font-bold hover:underline text-sm">View Fee Schedule</a>
              </div>
            </div>
          </Accordion>

          <Accordion title="Leaders Guidelines" icon={MapPin}>
            <div className="grid gap-3">
              {docs.filter(d => d.category === "leaders").map(d => (
                <div key={d.id} className="flex items-center justify-between p-4 bg-white rounded-xl border border-slate-200 group">
                  <div className="flex items-center gap-3">
                    <Compass size={20} className="text-slate-400" />
                    <span className="font-medium">{d.title}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <a href={d.url} target="_blank" className="text-emerald-600 font-bold hover:underline">View</a>
                    {isAdmin && <button onClick={() => handleDelete("documents", d.id)} className="text-red-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={16} /></button>}
                  </div>
                </div>
              ))}
            </div>
          </Accordion>

          <Accordion title="Useful Links" icon={ExternalLink}>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <h4 className="font-bold text-slate-400 uppercase text-[10px] tracking-widest">Paddling Resources</h4>
                <ul className="space-y-2">
                  <li><a href="https://www.britishcanoeing.org.uk/" target="_blank" className="text-sm text-slate-600 hover:text-emerald-600 flex items-center gap-2"><ExternalLink size={12} /> British Canoeing</a></li>
                  <li><a href="https://www.pla.co.uk/" target="_blank" className="text-sm text-slate-600 hover:text-emerald-600 flex items-center gap-2"><ExternalLink size={12} /> Port of London Authority</a></li>
                </ul>
              </div>
              <div className="space-y-3">
                <h4 className="font-bold text-slate-400 uppercase text-[10px] tracking-widest">Weather & Tides</h4>
                <ul className="space-y-2">
                  <li><a href="https://www.metoffice.gov.uk/" target="_blank" className="text-sm text-slate-600 hover:text-emerald-600 flex items-center gap-2"><ExternalLink size={12} /> Met Office Weather</a></li>
                  <li><a href="https://www.tidetimes.org.uk/" target="_blank" className="text-sm text-slate-600 hover:text-emerald-600 flex items-center gap-2"><ExternalLink size={12} /> Thames Tide Times</a></li>
                </ul>
              </div>
            </div>
          </Accordion>

          <Accordion title="Frequently Asked Questions" icon={HelpCircle}>
            <div className="space-y-4">
              {faqs.map(faq => (
                <Accordion key={faq.id} title={faq.question}>
                  <p className="text-slate-600 text-sm leading-relaxed">{faq.answer}</p>
                  {isAdmin && (
                    <div className="mt-4 pt-4 border-t flex justify-end">
                      <button onClick={() => handleDelete("faqs", faq.id)} className="text-red-400 hover:text-red-600 flex items-center gap-1 text-xs">
                        <Trash2 size={14} /> Delete FAQ
                      </button>
                    </div>
                  )}
                </Accordion>
              ))}
              {isAdmin && (
                <Button variant="outline" size="sm" className="w-full" onClick={() => setShowAddFaq(true)}>
                  <Plus size={14} /> Add New FAQ
                </Button>
              )}
            </div>
          </Accordion>
        </div>
      </section>

      {/* Admin Modals */}
      {showAddFaq && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="p-6 max-w-md w-full space-y-4">
            <h3 className="text-xl font-bold">Add FAQ</h3>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await addDoc(collection(db, "faqs"), {
                  question: f.get("question"),
                  answer: f.get("answer"),
                  order: Number(f.get("order")) || 0
                });
                setShowAddFaq(false);
              } catch (err) { handleFirestoreError(err, OperationType.CREATE, "faqs"); }
            }} className="space-y-4">
              <input name="question" placeholder="Question" required className="w-full p-2 border rounded-lg" />
              <textarea name="answer" placeholder="Answer" required className="w-full p-2 border rounded-lg h-32" />
              <input name="order" type="number" placeholder="Order (0)" className="w-full p-2 border rounded-lg" />
              <div className="flex gap-2">
                <Button type="submit" className="flex-1">Add</Button>
                <Button type="button" variant="outline" onClick={() => setShowAddFaq(false)}>Cancel</Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {showAddMember && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="p-6 max-w-md w-full space-y-4">
            <h3 className="text-xl font-bold">Add Committee Member</h3>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await addDoc(collection(db, "committee"), {
                  name: f.get("name"),
                  role: f.get("role"),
                  photoUrl: f.get("photoUrl"),
                  order: Number(f.get("order")) || 0
                });
                setShowAddMember(false);
              } catch (err) { handleFirestoreError(err, OperationType.CREATE, "committee"); }
            }} className="space-y-4">
              <input name="name" placeholder="Full Name" required className="w-full p-2 border rounded-lg" />
              <input name="role" placeholder="Role (e.g. Chairperson)" required className="w-full p-2 border rounded-lg" />
              <input name="photoUrl" placeholder="Photo URL" className="w-full p-2 border rounded-lg" />
              <input name="order" type="number" placeholder="Order (0)" className="w-full p-2 border rounded-lg" />
              <div className="flex gap-2">
                <Button type="submit" className="flex-1">Add</Button>
                <Button type="button" variant="outline" onClick={() => setShowAddMember(false)}>Cancel</Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {showAddReport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="p-6 max-w-md w-full space-y-4">
            <h3 className="text-xl font-bold">Add Annual Report</h3>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await addDoc(collection(db, "annual_reports"), {
                  year: Number(f.get("year")),
                  trusteesReportUrl: f.get("trusteesReportUrl"),
                  balanceSheetUrl: f.get("balanceSheetUrl"),
                  profitAndLossUrl: f.get("profitAndLossUrl"),
                  membershipStatsUrl: f.get("membershipStatsUrl")
                });
                setShowAddReport(false);
              } catch (err) { handleFirestoreError(err, OperationType.CREATE, "annual_reports"); }
            }} className="space-y-4">
              <input name="year" type="number" placeholder="Year (e.g. 2024)" required className="w-full p-2 border rounded-lg" />
              <input name="trusteesReportUrl" placeholder="Trustees Report URL" className="w-full p-2 border rounded-lg" />
              <input name="balanceSheetUrl" placeholder="Balance Sheet URL" className="w-full p-2 border rounded-lg" />
              <input name="profitAndLossUrl" placeholder="P&L URL" className="w-full p-2 border rounded-lg" />
              <input name="membershipStatsUrl" placeholder="Membership Stats URL" className="w-full p-2 border rounded-lg" />
              <div className="flex gap-2">
                <Button type="submit" className="flex-1">Add</Button>
                <Button type="button" variant="outline" onClick={() => setShowAddReport(false)}>Cancel</Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {showAddDoc && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="p-6 max-w-md w-full space-y-4">
            <h3 className="text-xl font-bold">Add Document</h3>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await addDoc(collection(db, "documents"), {
                  title: f.get("title"),
                  url: f.get("url"),
                  category: f.get("category")
                });
                setShowAddDoc(false);
              } catch (err) { handleFirestoreError(err, OperationType.CREATE, "documents"); }
            }} className="space-y-4">
              <input name="title" placeholder="Title" required className="w-full p-2 border rounded-lg" />
              <input name="url" placeholder="URL" required className="w-full p-2 border rounded-lg" />
              <select name="category" className="w-full p-2 border rounded-lg">
                <option value="cio">CIO Document</option>
                <option value="safety">Safety & Guidelines</option>
                <option value="leaders">Leaders Guidelines</option>
                <option value="other">Other</option>
              </select>
              <div className="flex gap-2">
                <Button type="submit" className="flex-1">Add</Button>
                <Button type="button" variant="outline" onClick={() => setShowAddDoc(false)}>Cancel</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
};

const PoolSessions = () => {
  return (
    <div className="max-w-4xl mx-auto py-12 space-y-12">
      <section className="space-y-4">
        <h1 className="text-4xl font-bold text-slate-900">Pool Sessions</h1>
        <EditableContent 
          pageId="pool" 
          sectionId="intro" 
          defaultContent="Our indoor pool sessions are the perfect environment to learn new skills, practice your roll, or just have some fun in a warm, controlled setting."
          className="text-xl text-slate-600 leading-relaxed"
        />
      </section>

      <div className="grid md:grid-cols-3 gap-6">
        <Card className="p-6 space-y-2 bg-emerald-50 border-emerald-100 text-center">
          <div className="text-emerald-600 font-bold text-lg">When</div>
          <EditableContent 
            pageId="pool" 
            sectionId="when" 
            defaultContent="Every Tuesday\n8:00 PM - 9:30 PM"
            className="text-slate-700"
          />
        </Card>
        <Card className="p-6 space-y-2 bg-emerald-50 border-emerald-100 text-center">
          <div className="text-emerald-600 font-bold text-lg">Where</div>
          <EditableContent 
            pageId="pool" 
            sectionId="where" 
            defaultContent="Local Leisure Centre\nMain Swimming Pool"
            className="text-slate-700"
          />
        </Card>
        <Card className="p-6 space-y-2 bg-emerald-50 border-emerald-100 text-center">
          <div className="text-emerald-600 font-bold text-lg">Cost</div>
          <EditableContent 
            pageId="pool" 
            sectionId="cost" 
            defaultContent="£10 per session\nIncludes boat hire"
            className="text-slate-700"
          />
        </Card>
      </div>

      <section className="space-y-6">
        <h2 className="text-2xl font-bold">What to Expect</h2>
        <div className="grid md:grid-cols-2 gap-8">
          <div className="space-y-4">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <CheckCircle2 className="text-emerald-500" size={20} /> Skill Development
            </h3>
            <EditableContent 
              pageId="pool" 
              sectionId="skills" 
              defaultContent="Coaches are available to help with everything from basic strokes to advanced rolling techniques. It's a great place to build confidence before heading out on the river."
              className="text-slate-600"
            />
          </div>
          <div className="space-y-4">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <CheckCircle2 className="text-emerald-500" size={20} /> Equipment Provided
            </h3>
            <EditableContent 
              pageId="pool" 
              sectionId="equipment" 
              defaultContent="We provide boats, paddles, and spray decks. You're also welcome to bring your own clean equipment (must be thoroughly washed before entering the pool)."
              className="text-slate-600"
            />
          </div>
        </div>
      </section>

      <section className="space-y-8">
        <h2 className="text-3xl font-bold">Upcoming Pool Sessions</h2>
        <Events filterType="pool" />
      </section>
    </div>
  );
};

const Profile = () => {
  const { user, profile: myProfile } = useAuth();
  const [searchParams] = useSearchParams();
  const uidParam = searchParams.get("uid");
  const targetUid = uidParam || user?.uid;
  
  const { allUsers } = useGlobal();
  const [targetProfile, setTargetProfile] = useState<UserProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const [ability, setAbility] = useState("");
  const [level, setLevel] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  const isLeader = myProfile?.role === "leader" || myProfile?.role === "admin" || myProfile?.role === "instructor";

  useEffect(() => {
    if (!targetUid) return;
    
    // Find in allUsers first
    const found = allUsers.find(u => u.uid === targetUid);
    if (found) {
      setTargetProfile(found);
      setAbility(found.abilityProfile || "");
      setLevel(found.paddlingLevel);
      setLoading(false);
    } else if (targetUid === user?.uid && myProfile) {
      setTargetProfile(myProfile);
      setAbility(myProfile.abilityProfile || "");
      setLevel(myProfile.paddlingLevel);
      setLoading(false);
    } else {
      // Fallback: fetch from DB directly if not in allUsers
      const fetchProfile = async () => {
        try {
          const snap = await getDoc(doc(db, "users", targetUid));
          if (snap.exists()) {
            const profileData = snap.data() as UserProfile;
            setTargetProfile(profileData);
            setAbility(profileData.abilityProfile || "");
            setLevel(profileData.paddlingLevel);
          }
        } catch (e) {
          console.error("Error fetching profile:", e);
        } finally {
          setLoading(false);
        }
      };
      fetchProfile();
    }
  }, [targetUid, allUsers, user?.uid, myProfile]);

  const saveProfile = async () => {
    if (!targetUid) return;
    try {
      if (db) {
        const updateData: any = { abilityProfile: ability };
        if (isLeader) {
          updateData.paddlingLevel = level;
        }
        await updateDoc(doc(db, "users", targetUid), updateData);
      }
      syncProfileToSupabase(targetUid, { abilityProfile: ability, paddlingLevel: level });
      setEditing(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${targetUid}`);
    }
  };

  const buyCoupons = async (count: number) => {
    if (!user) return;
    try {
      const response = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "coupon_purchase",
          userId: user.uid,
          userEmail: user.email,
          couponCount: count
        }),
      });
      const session = await safeJson(response);
      if (session.url) {
        window.location.href = session.url;
      }
    } catch (e) {
      alert("Failed to initiate coupon purchase.");
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Waves className="animate-spin text-emerald-600" size={48} /></div>;
  if (!targetProfile) return <div className="text-center py-20 text-slate-500">Profile not found.</div>;

  return (
    <div className="max-w-2xl mx-auto py-12 space-y-8">
      <div className="flex justify-between items-start">
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center font-bold text-2xl shadow-inner uppercase">
              {targetProfile.displayName?.[0] || targetProfile.email?.[0]}
            </div>
            <div className="space-y-1">
              <h2 className="text-3xl font-black text-slate-900 tracking-tight">{targetProfile.displayName}</h2>
              <p className="text-slate-500 text-sm">{targetProfile.email}</p>
            </div>
          </div>
          
          <div className="flex flex-wrap gap-2">
            <Badge variant="info">
              {targetProfile.role === "partner_club" ? "Partner Club" : targetProfile.role?.replace("_", " ").toUpperCase()}
            </Badge>
            <Badge variant="success" className="bg-emerald-50 text-emerald-700">{targetProfile.onboardingStatus.replace(/_/g, " ")}</Badge>
            {targetProfile.paddlingLevel && (
              <Badge variant={targetProfile.paddlingLevel === 1 ? "destructive" : targetProfile.paddlingLevel === 3 ? "info" : "secondary"}>
                LEVEL {targetProfile.paddlingLevel}: {targetProfile.paddlingLevel === 1 ? "BEGINNER" : targetProfile.paddlingLevel === 3 ? "EXPERT" : "GOOD"}
              </Badge>
            )}
          </div>
        </div>
        {(user?.uid === targetUid || isLeader) && (
          <Button variant="outline" onClick={() => setEditing(!editing)} className="shadow-sm">
            {editing ? "Cancel" : "Edit Details"}
          </Button>
        )}
      </div>

      {isLeader && editing && (
        <Card className="p-6 space-y-4 border-2 border-emerald-100 bg-emerald-50/20">
          <h3 className="text-xl font-bold flex items-center gap-2 text-emerald-700"><Shield size={20} /> Leader-Only Assignment</h3>
          <div className="space-y-2">
            <label className="text-sm font-medium">Certification / Skill Level</label>
            <select 
              value={level || ""}
              onChange={(e) => setLevel(Number(e.target.value))}
              className="w-full p-3 border rounded-xl bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              <option value="">No Level Assigned</option>
              <option value="1">Level 1: Beginner/Unexperienced (Red in Bookings)</option>
              <option value="2">Level 2: Good Paddler</option>
              <option value="3">Level 3: Expert (Underlined in Bookings)</option>
            </select>
            <p className="text-[10px] text-slate-500 italic">This level determines visual indicators in event participant lists for safety awareness.</p>
          </div>
        </Card>
      )}

      <Card className="p-8 space-y-6 shadow-xl border-slate-100">
        <div className="flex justify-between items-center border-b pb-4">
          <h3 className="text-xl font-bold flex items-center gap-2 tracking-tight"><Anchor size={20} className="text-emerald-500" /> Paddling Ability & Experience</h3>
          {!editing && targetProfile.paddlingLevel === 3 && <Badge variant="info" className="bg-blue-600 flex items-center gap-1 animate-pulse"><Zap size={12} /> Expert Assistant</Badge>}
        </div>
        {editing ? (
          <div className="space-y-4">
            <textarea 
              value={ability}
              onChange={(e) => setAbility(e.target.value)}
              placeholder="Describe your kayaking experience, certifications, and comfort level in different waters..."
              className="w-full h-40 p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
            />
            <Button onClick={saveProfile} className="w-full py-4 font-bold text-lg">Save Profile Updates</Button>
          </div>
        ) : (
          <div className="prose prose-slate max-w-none">
            {targetProfile.abilityProfile ? (
              <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">{targetProfile.abilityProfile}</p>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                <Info size={32} className="opacity-20 mb-2" />
                <p className="italic text-sm">No ability profile set.</p>
              </div>
            )}
          </div>
        )}
      </Card>

      {targetProfile.uid === user?.uid && targetProfile.role === "member" && (
        <Card className="p-8 bg-emerald-50 border-emerald-100 shadow-xl shadow-emerald-900/5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-white rounded-2xl text-emerald-600 shadow-sm">
              <Check size={24} />
            </div>
            <h3 className="text-xl font-bold text-emerald-900">Active Membership</h3>
          </div>
          <p className="text-emerald-700 leading-relaxed text-sm">You are a fully verified member of Putney Bridge Canoe Club. Your membership benefits are active and you can now book river tours and advanced training events.</p>
        </Card>
      )}

      {targetProfile.uid === user?.uid && (
        <Card className="p-8 space-y-6 shadow-xl border-slate-100">
          <div className="flex justify-between items-center">
            <h3 className="text-xl font-bold flex items-center gap-2"><Ticket size={24} className="text-blue-500" /> Child Pool Coupons</h3>
            <Badge variant="secondary" className="px-3 py-1 font-mono text-lg">{targetProfile.childCoupons || 0}</Badge>
          </div>
          <div className="grid md:grid-cols-1 gap-4">
            <div className="space-y-4">
              <p className="text-sm font-medium text-slate-600 leading-relaxed">Pool assessment coupons for children under 18. Each coupon covers one Wednesday evening session.</p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 h-16 rounded-2xl flex flex-col items-start px-6 gap-0 hover:border-blue-300 hover:bg-blue-50 transition-all group" onClick={() => buyCoupons(5)}>
                  <span className="text-xs font-bold text-slate-400 group-hover:text-blue-500 uppercase tracking-widest">Pre-pay for 5</span>
                  <span className="text-lg font-black text-slate-900">£25.00</span>
                </Button>
                <Button variant="outline" className="flex-1 h-16 rounded-2xl flex flex-col items-start px-6 gap-0 hover:border-emerald-300 hover:bg-emerald-50 transition-all group" onClick={() => buyCoupons(1)}>
                  <span className="text-xs font-bold text-slate-400 group-hover:text-emerald-500 uppercase tracking-widest">Single Entry</span>
                  <span className="text-lg font-black text-slate-900">£5.00</span>
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};

// --- Main App & Layout ---

// --- Main App & Layout ---

const Layout = ({ children, onFeedbackOpen }: { children: React.ReactNode, onFeedbackOpen: () => void }) => {
  const { user, profile, loading } = useAuth();
  const { visibility: globalVisibility } = useGlobal();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [loadingStuck, setLoadingStuck] = useState(false);
  const { showReceipt } = useUI();

  const visibility = useMemo(() => {
    if (!profile) return [];
    const role = profile.role === "admin" ? "financial" : profile.role;
    return globalVisibility[role] || [];
  }, [profile, globalVisibility]);

  useEffect(() => {
    if (!profile) {
      const timer = setTimeout(() => {
        if (user && !profile && !loading) {
          console.warn("[Layout] Profile stuck. Possible rules conflict or network issue.");
          setLoadingStuck(true);
        }
      }, 5000);
      return () => clearTimeout(timer);
    } else {
      setLoadingStuck(false);
    }
  }, [profile, user, loading]);

  const navItems = [
    { label: "About Us", path: "/about" },
    { label: "Pool Sessions", path: "/pool-sessions" },
    { label: "Events", path: "/events" },
    { label: "Boats", path: "/boats" },
    { label: "Links", path: "/links" },
    { label: "Contact", path: "/contact" },
    { label: "Join Us", path: "/onboarding", show: profile?.role === "guest" || profile?.role === "future_member" },
    { label: "Leader", path: "/dashboard/leader", show: profile?.role === "leader" || profile?.role === "admin" || profile?.role === "instructor" },
    { label: "Finance", path: "/dashboard/financial", show: profile?.role === "financial" || profile?.role === "admin" || visibility.includes("upload_expense") },
    { label: "Social", path: "/dashboard/social", show: !!profile },
    { label: "Partner Club", path: "/dashboard/club", show: profile?.role === "partner_club" || profile?.role === "admin" },
    { label: "Admin", path: "/dashboard/admin", show: profile?.role === "admin" },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link to="/" className="flex items-center gap-2 text-emerald-600 font-bold text-xl">
                <Waves size={28} />
                <span className="hidden sm:inline text-slate-900">PutneyBridgeCC</span>
              </Link>
              <div className="hidden md:ml-8 md:flex md:space-x-4">
                {navItems.filter(i => i.show !== false).map(item => (
                  <Link key={item.path} to={item.path} className="text-slate-600 hover:text-emerald-600 px-3 py-2 text-sm font-medium transition-colors">
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-4">
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-slate-100 rounded-full animate-pulse" />
                  {loadingStuck && (
                    <button 
                      onClick={() => window.location.reload()}
                      className="text-[10px] bg-amber-50 text-amber-600 px-2 py-1 rounded font-bold uppercase tracking-tighter hover:bg-amber-100"
                    >
                      Refresh
                    </button>
                  )}
                </div>
              ) : user ? (
                <div className="flex items-center gap-4">
                  <Link to="/profile" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                    <div className="w-8 h-8 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center font-bold text-xs">
                      {user.displayName?.charAt(0) || user.email?.charAt(0)}
                    </div>
                    <span className="hidden sm:inline text-sm font-medium text-slate-700">{user.displayName || "Profile"}</span>
                  </Link>
                  <Button variant="ghost" size="sm" onClick={logOut}><LogOut size={18} /></Button>
                </div>
              ) : (
                <Button size="sm" onClick={signIn}>Sign In</Button>
              )}
              <button className="md:hidden text-slate-600" onClick={() => setIsMenuOpen(!isMenuOpen)}>
                {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
              </button>
            </div>
          </div>
        </div>
        {/* Mobile Menu */}
        {isMenuOpen && (
          <div className="md:hidden bg-white border-b border-slate-200 p-4 space-y-2">
            {navItems.filter(i => i.show !== false).map(item => (
              <Link key={item.path} to={item.path} onClick={() => setIsMenuOpen(false)} className="block px-3 py-2 text-base font-medium text-slate-600 hover:text-emerald-600 hover:bg-slate-50 rounded-lg">
                {item.label}
              </Link>
            ))}
          </div>
        )}
      </nav>

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
        {children}
      </main>

      {user && (
        <button 
          onClick={() => onFeedbackOpen()}
          className="fixed bottom-6 right-6 p-4 bg-amber-500 text-white rounded-full shadow-2xl hover:bg-amber-600 hover:scale-110 transition-all z-[100] group flex items-center gap-2 overflow-hidden max-w-[56px] hover:max-w-[200px] whitespace-nowrap"
          title="Site Feedback & Ideas"
        >
          <MessageSquare size={24} />
          <span className="font-bold pr-2">Site Feedback & Ideas</span>
        </button>
      )}

      <CookieConsent />
      <ConductConsentModal />

      <footer className="bg-white border-t border-slate-200 py-12 mt-12 text-left">
        <div className="max-w-7xl mx-auto px-4 grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-emerald-600 font-black italic text-xl">
              <Waves size={28} /> <span>PBCC</span>
            </div>
            <p className="text-slate-500 text-xs leading-relaxed">
              Putney Bridge Canoe Club. Encouraging sport, competition and community on the Thames and beyond.
            </p>
          </div>
          
          <div className="space-y-4">
            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Club</h4>
            <ul className="space-y-2 text-sm text-slate-600 font-medium">
              <li><Link to="/pool-sessions" className="hover:text-emerald-600 transition-colors">Pool Sessions</Link></li>
              <li><Link to="/documents" className="hover:text-emerald-600 transition-colors">Club Documents</Link></li>
              <li><Link to="/onboarding" className="hover:text-emerald-600 transition-colors">Join Us</Link></li>
            </ul>
          </div>

          <div className="space-y-4">
            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Partners</h4>
            <ul className="space-y-2 text-sm text-slate-600 font-medium">
              <li><Link to="/partners/join" className="hover:text-emerald-600 transition-colors underline decoration-emerald-200">Become a Partner Club</Link></li>
              <li><Link to="/dashboard/club" className="hover:text-emerald-600 transition-colors">Partner Portal</Link></li>
            </ul>
          </div>

          <div className="space-y-4">
            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Legal</h4>
            <ul className="space-y-2 text-sm text-slate-600 font-medium">
              <li><Link to="/cookie-policy" className="hover:text-emerald-600 transition-colors">Cookie Policy</Link></li>
              <li><a href="mailto:pbcc.web@gmail.com" className="hover:text-emerald-600 transition-colors">Contact Support</a></li>
            </ul>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 mt-12 pt-8 border-t border-slate-100 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">© 2026 Putney Bridge CC. CIO Registered Charity.</p>
          <div className="flex gap-4">
            {/* Social links could go here */}
          </div>
        </div>
      </footer>
    </div>
  );
};

let openAuthModalFn: () => void = () => {};

export const signIn = () => {
  openAuthModalFn();
};

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AuthModal = ({ isOpen, onClose }: AuthModalProps) => {
  const [tab, setTab] = useState<"signin" | "register" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      await signInWithGoogle();
      onClose();
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Google Sign-In failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signInWithEmail(email, password);
      onClose();
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Invalid email or password.");
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signUpWithEmail(email, password, displayName);
      setSuccess("Account created successfully!");
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Registration failed. Try a different email.");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      await resetPassword(email);
      setSuccess("Password reset email sent! Check your inbox.");
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to send reset email.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[999999] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md bg-white rounded-3xl border border-slate-100 shadow-2xl overflow-hidden"
      >
        <div className="relative p-8 space-y-6">
          <button 
            onClick={onClose} 
            className="absolute top-6 right-6 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
          >
            <X size={20} />
          </button>

          <div className="text-center space-y-1">
            <h2 className="text-3xl font-black italic tracking-tight text-slate-900">
              {tab === "signin" && <>Welcome <span className="text-emerald-600">Back</span></>}
              {tab === "register" && <>Join the <span className="text-emerald-600">Club</span></>}
              {tab === "forgot" && <>Reset <span className="text-emerald-600">Password</span></>}
            </h2>
            <p className="text-slate-500 text-sm">Putney Bridge Canoe Club</p>
          </div>

          {error && (
            <div className="p-4 bg-red-50 rounded-2xl border border-red-100 text-sm text-red-600 flex items-start gap-3">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 text-sm text-emerald-700 flex items-start gap-3">
              <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
              <span>{success}</span>
            </div>
          )}

          {tab !== "forgot" && (
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-2xl">
              <button
                type="button"
                onClick={() => { setTab("signin"); setError(null); setSuccess(null); }}
                className={cn(
                  "py-2 px-4 rounded-xl text-sm font-bold transition-all",
                  tab === "signin" ? "bg-white shadow-sm text-emerald-600" : "text-slate-500 hover:text-slate-800"
                )}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => { setTab("register"); setError(null); setSuccess(null); }}
                className={cn(
                  "py-2 px-4 rounded-xl text-sm font-bold transition-all",
                  tab === "register" ? "bg-white shadow-sm text-emerald-600" : "text-slate-500 hover:text-slate-800"
                )}
              >
                Create Account
              </button>
            </div>
          )}

          <div className="space-y-4">
            {/* Google Sign-in Option */}
            {tab !== "forgot" && (
              <>
                <button
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-50 text-slate-700 font-bold py-4 px-6 border border-slate-200 rounded-2xl transition-all shadow-sm active:scale-[0.98]"
                >
                  <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                    <path fill="#EA4335" d="M12.24 10.285V14.4h6.887c-.275 1.565-1.88 4.604-6.887 4.604-4.33 0-7.859-3.578-7.859-8s3.53-8 7.859-8c2.46 0 4.105 1.025 5.047 1.926l3.227-3.103C18.28 1.844 15.54 1 12.24 1 5.92 1 12.24s4.92 11.24 11.24 11.24c6.6 0 11-4.64 11-11.24 0-.756-.08-1.333-.18-1.955H12.24z"/>
                  </svg>
                  <span>Continue with Google</span>
                </button>
                <div className="text-center text-[11px] text-slate-400 leading-normal">
                  If the Google popup is blocked by your browser, please sign in or register with email below.
                </div>
                <div className="relative flex py-2 items-center">
                  <div className="flex-grow border-t border-slate-100"></div>
                  <span className="flex-shrink mx-4 text-slate-400 text-xs font-bold uppercase tracking-wider">or</span>
                  <div className="flex-grow border-t border-slate-100"></div>
                </div>
              </>
            )}

            {/* Email / Password Sign In Form */}
            {tab === "signin" && (
              <form onSubmit={handleEmailSignIn} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">Email Address</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full p-4 border border-slate-200 rounded-2xl bg-slate-50 outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all text-sm"
                    placeholder="you@example.com"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">Password</label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full p-4 border border-slate-200 rounded-2xl bg-slate-50 outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all text-sm"
                    placeholder="••••••••"
                  />
                </div>
                <div className="text-right">
                  <button
                    type="button"
                    onClick={() => { setTab("forgot"); setError(null); setSuccess(null); }}
                    className="text-xs text-emerald-600 hover:text-emerald-700 font-bold"
                  >
                    Forgot Password?
                  </button>
                </div>
                <Button type="submit" disabled={loading} className="w-full py-4 rounded-2xl font-bold text-base shadow-lg shadow-emerald-100">
                  {loading ? <RefreshCw size={20} className="animate-spin mx-auto" /> : "Sign In"}
                </Button>
              </form>
            )}

            {/* Email / Password Sign Up Form */}
            {tab === "register" && (
              <form onSubmit={handleEmailSignUp} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">Your Name</label>
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full p-4 border border-slate-200 rounded-2xl bg-slate-50 outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all text-sm"
                    placeholder="John Doe"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">Email Address</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full p-4 border border-slate-200 rounded-2xl bg-slate-50 outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all text-sm"
                    placeholder="you@example.com"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">Password</label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full p-4 border border-slate-200 rounded-2xl bg-slate-50 outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all text-sm"
                    placeholder="Minimum 6 characters"
                    minLength={6}
                  />
                </div>
                <Button type="submit" disabled={loading} className="w-full py-4 rounded-2xl font-bold text-base shadow-lg shadow-emerald-100">
                  {loading ? <RefreshCw size={20} className="animate-spin mx-auto" /> : "Create Account"}
                </Button>
              </form>
            )}

            {/* Forgot Password Form */}
            {tab === "forgot" && (
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">Email Address</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full p-4 border border-slate-200 rounded-2xl bg-slate-50 outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all text-sm"
                    placeholder="you@example.com"
                  />
                </div>
                <Button type="submit" disabled={loading} className="w-full py-4 rounded-2xl font-bold text-base shadow-lg shadow-emerald-100">
                  {loading ? <RefreshCw size={20} className="animate-spin mx-auto" /> : "Send Reset Email"}
                </Button>
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => { setTab("signin"); setError(null); setSuccess(null); }}
                    className="text-xs text-slate-500 hover:text-slate-800 font-bold"
                  >
                    Back to Sign In
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [allBoats, setAllBoats] = useState<Boat[]>([]);
  const [visibility, setVisibility] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [pendingConfirm, setPendingConfirm] = useState<{ message: string, onConfirm: () => void } | null>(null);
  const [pendingAlert, setPendingAlert] = useState<string | null>(null);
  const [activeReceipt, setActiveReceipt] = useState<string | null>(null);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [paymentRedirectUrl, setPaymentRedirectUrl] = useState<string | null>(null);
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const uiValue = {
    confirm: (message: string, onConfirm: () => void) => setPendingConfirm({ message, onConfirm }),
    alert: (message: string) => setPendingAlert(message),
    showReceipt: (url: string) => setActiveReceipt(url),
    openPaymentTask: (url: string) => setPaymentRedirectUrl(url),
  };

  useEffect(() => {
    openAuthModalFn = () => setIsAuthModalOpen(true);
    let unsubscribeProfile: (() => void) | null = null;
    let unsubscribeAllUsers: (() => void) | null = null;
    let unsubscribeAllBoats: (() => void) | null = null;
    let unsubscribeVisibility: (() => void) | null = null;

    const handleStripeRedirect = (e: any) => {
      setPaymentRedirectUrl(e.detail.url);
    };
    window.addEventListener("STRIPE_REDIRECT_REQUESTED", handleStripeRedirect);

    const unsubscribeAuth = onAuthStateChanged(auth, async (u) => {
      // Clean up previous listeners
      if (unsubscribeProfile) { unsubscribeProfile(); unsubscribeProfile = null; }
      if (unsubscribeAllUsers) { unsubscribeAllUsers(); unsubscribeAllUsers = null; }
      if (unsubscribeAllBoats) { unsubscribeAllBoats(); unsubscribeAllBoats = null; }
      if (unsubscribeVisibility) { unsubscribeVisibility(); unsubscribeVisibility = null; }

      setUser(u);
      if (u) {
        console.log("[Auth] User logged in:", u.uid, u.email);
        try {
          if (!db) return;
          
          // 1. Initial Profile
          const userRef = doc(db, "users", u.uid);
          const userSnap = await getDoc(userRef);
          if (userSnap.exists()) {
            const data = { ...userSnap.data() } as UserProfile;
            if (u.email === "pbcc.web@gmail.com") {
              data.role = "admin";
              data.onboardingStatus = "membership_paid";
            }
            setProfile(data);
          } else if (u.email === "pbcc.web@gmail.com") {
            setProfile({
              uid: u.uid,
              email: u.email,
              role: "admin",
              onboardingStatus: "membership_paid",
              displayName: u.displayName || "Admin",
              firstName: "Admin",
              lastName: ""
            } as any);
          }
          
          // 2. Global Listeners
          unsubscribeAllUsers = onSnapshot(collection(db, "users"), (snap) => {
            setAllUsers(snap.docs.map(d => {
              const uData = { uid: d.id, ...d.data() } as UserProfile;
              if (uData.email === "pbcc.web@gmail.com") {
                uData.role = "admin";
                uData.onboardingStatus = "membership_paid";
              }
              return uData;
            }));
          }, (err) => {
            console.error("[Global] Users snapshot failed:", err);
            // Optionally handle it in UI
          });
          
          unsubscribeAllBoats = onSnapshot(collection(db, "boats"), (snap) => {
            setAllBoats(snap.docs.map(d => ({ id: d.id, ...d.data() } as Boat)));
          });

          unsubscribeVisibility = onSnapshot(doc(db, "settings", "visibility"), (snap) => {
            if (snap.exists()) setVisibility(snap.data());
          });

          unsubscribeProfile = onSnapshot(userRef, (snap) => {
            if (snap.exists()) {
              const data = { ...snap.data() } as UserProfile;
              if (u.email === "pbcc.web@gmail.com") {
                data.role = "admin";
                data.onboardingStatus = "membership_paid";
              }
              setProfile(data);
            } else if (u.email === "pbcc.web@gmail.com") {
              setProfile({
                uid: u.uid,
                email: u.email,
                role: "admin",
                onboardingStatus: "membership_paid",
                displayName: u.displayName || "Admin",
                firstName: "Admin",
                lastName: ""
              } as any);
            }
          });
        } catch (e) {
          console.error("[Auth] Setup error:", e);
        }
      } else {
        setProfile(null);
        setAllUsers([]);
        setAllBoats([]);
        setVisibility({});
      }
      setLoading(false);
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
      if (unsubscribeAllUsers) unsubscribeAllUsers();
      if (unsubscribeAllBoats) unsubscribeAllBoats();
      if (unsubscribeVisibility) unsubscribeVisibility();
      window.removeEventListener("STRIPE_REDIRECT_REQUESTED", handleStripeRedirect);
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, loading }}>
      <GlobalContext.Provider value={{ 
        allUsers: useMemo(() => {
          console.log("[GlobalContext] Users in provider:", allUsers.length);
          return allUsers;
        }, [allUsers]), 
        allBoats, 
        profile, 
        visibility 
      }}>
        <UIContext.Provider value={uiValue}>
          <ErrorBoundary>
            <Router>
              <Layout onFeedbackOpen={() => setShowFeedbackDialog(true)}>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/about" element={<AboutUs />} />
                  <Route path="/pool-sessions" element={<PoolSessions />} />
                  <Route path="/events" element={<Events />} />
                  <Route path="/boats" element={<Boats />} />
                  <Route path="/links" element={<LinksPage />} />
                  <Route path="/contact" element={<ContactPage />} />
                  <Route path="/cookie-policy" element={<CookiePolicy />} />
                  <Route path="/onboarding" element={<Onboarding />} />
                  <Route path="/payment-success" element={<PaymentSuccess />} />
                  <Route path="/profile" element={<Profile />} />
                  
                  {/* Protected Dashboards */}
                  <Route path="/partners/join" element={<BecomePartner />} />
                  <Route path="/dashboard/leader" element={profile?.role === "leader" || profile?.role === "admin" || profile?.role === "instructor" ? <LeaderDashboard /> : <Home />} />
                  <Route path="/dashboard/financial" element={user ? <FinancialDashboard /> : <Home />} />
                  <Route path="/dashboard/social" element={user ? <SocialDashboard /> : <Home />} />
                  <Route path="/logbook/:eventId" element={user ? <MobileLogbook /> : <Home />} />
                  <Route path="/dashboard/club" element={profile?.role === "partner_club" || profile?.role === "admin" ? <PartnerClubDashboard /> : <Home />} />
                  <Route path="/dashboard/admin" element={profile?.role === "admin" || user?.email === "pbcc.web@gmail.com" ? <AdminDashboard /> : <Home />} />
                </Routes>
              </Layout>

              {showFeedbackDialog && (
                <FeedbackDialog isOpen={showFeedbackDialog} onClose={() => setShowFeedbackDialog(false)} />
              )}

              {isAuthModalOpen && (
                <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
              )}

            {/* Global Modals */}
            {pendingConfirm && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                <Card className="p-6 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200">
                  <h4 className="text-xl font-bold mb-2 flex items-center gap-2">
                    <AlertTriangle className="text-amber-500" size={24} /> Confirm Action
                  </h4>
                  <p className="text-slate-600 mb-8">{pendingConfirm.message}</p>
                  <div className="flex justify-end gap-3">
                    <Button variant="outline" onClick={() => setPendingConfirm(null)}>Cancel</Button>
                    <Button variant="primary" onClick={() => { pendingConfirm.onConfirm(); setPendingConfirm(null); }}>Proceed</Button>
                  </div>
                </Card>
              </div>
            )}

            {pendingAlert && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                <Card className="p-6 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200">
                  <h4 className="text-xl font-bold mb-2 flex items-center gap-2">
                    <Info className="text-blue-500" size={24} /> Notification
                  </h4>
                  <p className="text-slate-600 mb-8">{pendingAlert}</p>
                  <div className="flex justify-end">
                    <Button variant="primary" onClick={() => setPendingAlert(null)}>Understood</Button>
                  </div>
                </Card>
              </div>
            )}

            {activeReceipt && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-300" onClick={() => setActiveReceipt(null)}>
                <div className="relative max-w-5xl w-full bg-white rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300" onClick={e => e.stopPropagation()}>
                  <div className="p-4 bg-slate-50 border-b flex justify-between items-center">
                    <h4 className="font-bold flex items-center gap-2"><FileText size={18} /> Receipt Document</h4>
                    <div className="flex items-center gap-2">
                      <a href={activeReceipt} target="_blank" rel="noopener noreferrer" className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                        <ExternalLink size={20} />
                      </a>
                      <button onClick={() => setActiveReceipt(null)} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                        <X size={20} />
                      </button>
                    </div>
                  </div>
                  <div className="p-2 bg-slate-100 flex items-center justify-center min-h-[400px]">
                    {activeReceipt.toLowerCase().includes('.pdf') ? (
                      <iframe src={activeReceipt} className="w-full h-[70vh]" title="Receipt" />
                    ) : (
                      <img src={activeReceipt} className="max-w-full max-h-[80vh] object-contain shadow-sm rounded-lg" alt="Receipt" referrerPolicy="no-referrer" />
                    )}
                  </div>
                  <div className="p-4 bg-slate-50 text-center">
                    <p className="text-xs text-slate-400">Click anywhere outside to close</p>
                  </div>
                </div>
              </div>
            )}

            {paymentRedirectUrl && (
              <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-slate-900/95 backdrop-blur-xl p-4 animate-in fade-in duration-300">
                <Card className="p-0 max-w-lg w-full bg-white rounded-[2.5rem] shadow-2xl overflow-hidden animate-in slide-in-from-bottom-8 duration-500 cubic-bezier(0.16, 1, 0.3, 1)">
                  <div className="p-10 text-center space-y-6">
                    <div className="bg-emerald-50 w-24 h-24 rounded-3xl flex items-center justify-center mx-auto text-emerald-600 mb-2">
                      <motion.div
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: 0.2, type: "spring" }}
                      >
                        <ShieldCheck size={48} />
                      </motion.div>
                    </div>
                    
                    <div className="flex gap-2 justify-center">
                      <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full">Secure Link v4.12</span>
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 bg-slate-100 px-3 py-1 rounded-full">Stripe Verified</span>
                    </div>

                    <div className="space-y-2">
                      <h3 className="text-3xl font-black text-slate-900 tracking-tight">Payment Ready</h3>
                      <p className="text-slate-500 text-lg leading-relaxed">
                        Redirection was blocked by your browser. This is a normal security measure. Click below to open <b>Stripe Checkout</b> in a new tab.
                      </p>
                    </div>

                    <div className="pt-4 space-y-4">
                      <a 
                        href={paymentRedirectUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="block w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-5 px-8 rounded-2xl text-xl shadow-xl shadow-emerald-200 transform hover:-translate-y-1 transition-all active:scale-[0.98]"
                        onClick={() => {
                          // Clear the modal after a short delay so they can return to a clean state
                          setTimeout(() => setPaymentRedirectUrl(null), 2000);
                        }}
                      >
                        Open Secure Checkout
                      </a>
                      <Button 
                        variant="ghost" 
                        className="w-full text-slate-400 font-bold hover:text-slate-600 h-10"
                        onClick={() => { setPaymentRedirectUrl(null); window.location.reload(); }}
                      >
                        Cancel & Go Back
                      </Button>
                    </div>
                  </div>
                  <div className="bg-slate-50 p-4 border-t border-slate-100 text-center">
                    <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Encrypted Connection Protected by Stripe</p>
                  </div>
                </Card>
              </div>
            )}
          </Router>
        </ErrorBoundary>
      </UIContext.Provider>
    </GlobalContext.Provider>
  </AuthContext.Provider>
);
}
