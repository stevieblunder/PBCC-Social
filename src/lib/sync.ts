import { supabase } from "./supabase";

export const syncProfileToSupabase = async (uid: string, updates: any) => {
  if (!supabase) return;
  
  const mapping: any = {
    id: uid,
    email: updates.email,
    display_name: updates.displayName || (updates.firstName && updates.lastName ? `${updates.firstName} ${updates.lastName}` : undefined),
    first_name: updates.firstName,
    last_name: updates.lastName,
    role: updates.role,
    onboarding_status: updates.onboardingStatus,
    onboarding_path: updates.onboardingPath,
    mobile_number: updates.mobileNumber,
    house_street: updates.houseNameNumberStreet,
    town: updates.town,
    county: updates.county,
    postcode: updates.postcode,
    birth_year: updates.yearOfBirth,
    gender: updates.sex,
    years_paddling: updates.yearsPaddling,
    awards: updates.britishCanoeingAwards,
    bc_member: updates.britishCanoeingMember,
    paddling_desc: updates.paddlingDescription,
    emergency_contact_name: updates.emergencyContactName,
    emergency_contact_phone: updates.emergencyContactPhone,
    emergency_contact_relationship: updates.emergencyContactRelationship,
    newsletter: updates.newsletter,
    has_disability: updates.hasDisability,
    disability_details: updates.disabilityDetails,
    member_number: updates.memberNumber,
    lee_valley_assessment: updates.leeValleyAssessment,
    first_aid_safeguarding: updates.firstAidSafeguarding,
    navigation_qualifications: updates.navigationQualifications,
    leadership_experience: updates.leadershipExperience,
    key_holder: updates.keyHolder,
    committee_member: updates.committeeMember,
    boat_storage: updates.boatStorage,
    thames_leader: updates.thamesLeader,
    membership_expiry: updates.expiresOn?.toDate ? updates.expiresOn.toDate().toISOString() : updates.expiresOn,
    updated_at: new Date().toISOString()
  };
  
  // Remove undefined values
  Object.keys(mapping).forEach(key => {
    if (mapping[key] === undefined) delete mapping[key];
  });

  const { error } = await supabase.from('profiles').upsert(mapping);
  if (error) console.error("[Supabase Profile Sync Error]", error);
};

export const syncBoatToSupabase = async (firebaseId: string, data: any) => {
  if (!supabase) return;

  const mapping: any = {
    firebase_id: firebaseId,
    name: data.name,
    type: data.type,
    brand: data.brand,
    model: data.model,
    colour: data.colour,
    paddler_weight: data.paddlerWeight,
    notes: data.notes,
    description: data.description,
    status: data.status,
    location: data.location,
    length: data.length,
    image_url: data.imageUrl,
    cost_per_day: data.costPerDay,
    cost_per_weekend: data.costPerWeekend,
    cost_per_day_long: data.costPerDayOver,
    updated_at: new Date().toISOString()
  };

  // Remove undefined values
  Object.keys(mapping).forEach(key => {
    if (mapping[key] === undefined) delete mapping[key];
  });

  // Try to find if it exists by firebase_id first
  const { data: existing } = await supabase.from('boats').select('id').eq('firebase_id', firebaseId).maybeSingle();

  if (existing) {
    const { error } = await supabase.from('boats').update(mapping).eq('firebase_id', firebaseId);
    if (error) console.error("[Supabase Boat Sync Update Error]", error);
  } else {
    const { error } = await supabase.from('boats').insert(mapping);
    if (error) console.error("[Supabase Boat Sync Insert Error]", error);
  }
};

export const deleteProfileFromSupabase = async (uid: string) => {
  if (!supabase) return;
  const { error } = await supabase.from('profiles').delete().eq('id', uid);
  if (error) console.error("[Supabase Profile Delete Error]", error);
};
