-- USERS TABLE (Transition Friendly)
CREATE TABLE IF NOT EXISTS public.profiles (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  display_name TEXT,
  first_name TEXT,
  last_name TEXT,
  role TEXT DEFAULT 'guest',
  onboarding_status TEXT DEFAULT 'pending',
  medical_conditions TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  emergency_contact_relationship TEXT,
  membership_expiry TIMESTAMP WITH TIME ZONE,
  birth_year INTEGER,
  gender TEXT,
  mobile_number TEXT,
  house_street TEXT,
  town TEXT,
  county TEXT,
  postcode TEXT,
  years_paddling TEXT,
  awards TEXT,
  qualifications TEXT,
  bc_member BOOLEAN,
  lee_valley_assessment TEXT,
  first_aid_safeguarding TEXT,
  navigation_qualifications TEXT,
  leadership_experience TEXT,
  paddling_desc TEXT,
  newsletter BOOLEAN DEFAULT false,
  member_number TEXT,
  disability_details TEXT,
  has_disability BOOLEAN DEFAULT false,
  photo_url TEXT,
  key_holder BOOLEAN DEFAULT false,
  committee_member BOOLEAN DEFAULT false,
  boat_storage TEXT,
  thames_leader BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- PAYMENTS TABLE
CREATE TABLE IF NOT EXISTS public.payments (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT,
  user_email TEXT,
  amount DECIMAL(10, 2),
  type TEXT,
  status TEXT,
  stripe_session_id TEXT UNIQUE,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- EVENTS TABLE
CREATE TABLE IF NOT EXISTS public.events (
  id BIGSERIAL PRIMARY KEY,
  title TEXT,
  description TEXT,
  type TEXT,
  start_time TIMESTAMP WITH TIME ZONE,
  end_time TIMESTAMP WITH TIME ZONE,
  location TEXT,
  capacity INTEGER,
  price DECIMAL(10, 2),
  participants TEXT[] DEFAULT '{}',
  leader_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- BOATS TABLE
CREATE TABLE IF NOT EXISTS public.boats (
  id BIGSERIAL PRIMARY KEY,
  name TEXT,
  type TEXT,
  brand TEXT,
  model TEXT,
  colour TEXT,
  paddler_weight TEXT,
  notes TEXT,
  description TEXT,
  image_url TEXT,
  status TEXT DEFAULT 'available',
  location TEXT,
  cost_per_day DECIMAL(10, 2) DEFAULT 0,
  cost_per_weekend DECIMAL(10, 2) DEFAULT 0,
  cost_per_day_long DECIMAL(10, 2) DEFAULT 0,
  length TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RENTALS TABLE
CREATE TABLE IF NOT EXISTS public.rentals (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT, -- Changed from UUID to TEXT
  boat_id BIGINT REFERENCES public.boats(id) ON DELETE CASCADE,
  start_date DATE,
  end_date DATE,
  status TEXT DEFAULT 'pending',
  amount DECIMAL(10, 2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- EXPENSES TABLE
CREATE TABLE IF NOT EXISTS public.expenses (
  id BIGSERIAL PRIMARY KEY,
  amount DECIMAL(10, 2),
  description TEXT,
  authorised_by TEXT,
  image_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS RULES (Basic)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- PAYMENTS SECURITY (Service Role usually handles this)
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can see own payments" ON public.payments FOR SELECT USING (auth.uid() = user_id);
