import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import Stripe from "stripe";
import dotenv from "dotenv";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

// Global config objects
let firebaseConfig: any = {};
try {
  if (fs.existsSync("./firebase-applet-config.json")) {
    const rawConfig = fs.readFileSync("./firebase-applet-config.json", "utf-8");
    if (rawConfig.trim()) {
      firebaseConfig = JSON.parse(rawConfig);
    }
  }
} catch (e) {
  console.error("[Firebase Setup] Failed to read or parse firebase-applet-config.json", e);
}

import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import multer from "multer";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

// Initialize Supabase Admin (Service Role)
let supabaseAdmin: any = null;
try {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
  if (supabaseUrl && supabaseServiceRole) {
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceRole);
    console.log("[Supabase v4.3] Admin Client Initialized.");
  } else {
    console.warn("[Supabase v4.3] Configuration missing. Supabase writes WILL BE SKIPPED.");
  }
} catch (err: any) {
  console.error("[Supabase v4.3] Initialization error:", err.message);
}

// Initialize Multer for temporary file handling
const upload = multer({ storage: multer.memoryStorage() });

// Mail Configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_PORT === "465",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendEmail({ to, subject, html }: { to: string, subject: string, html: string }) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("[Email] Skipping email send: SMTP credentials not configured.");
    return;
  }

  try {
    const info = await transporter.sendMail({
      from: `"${process.env.EMAIL_FROM_NAME || "Putney Bridge CC"}" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });
    console.log(`[Email] Sent: ${info.messageId} to ${to}`);
  } catch (error) {
    console.error(`[Email Error] Failed to send to ${to}:`, error);
  }
}

// Initialize Firebase Admin
let db: any;
let dbHasPermission = true;
let initSummary: any[] = [];

async function initializeFirebase() {
  initSummary = [];
  const projectId = firebaseConfig?.projectId;
  const dbId = firebaseConfig?.firestoreDatabaseId;

  if (!projectId) {
    console.warn("[Firebase v4.12] No projectId found. Firebase functionality will be disabled.");
    initSummary.push({ status: "disabled", reason: "No projectId" });
    db = null;
    dbHasPermission = false;
    return;
  }

  try {
    console.log(`[Firebase v4.12] Initializing Project: ${projectId}, DB: ${dbId || '(default)'}...`);
    
    // Ensure we have a [DEFAULT] app
    let app = admin.apps.find(a => a?.name === "[DEFAULT]");
    if (app) await app.delete();
    
    app = admin.initializeApp({ projectId }); 
    db = getFirestore(app, dbId || undefined);
    
    // Run access verification in the background so it doesn't block server startup
    (async () => {
      try {
        console.log(`[Firebase v4.12] Verifying access to ${projectId}...`);
        
        // Use a timeout for the ping to avoid hanging the process if metadata server is slow
        const pingPromise = db.collection("_system_check").doc("ping").set({
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          source: "server-init-v12",
          projectId
        }, { merge: true });

        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Firebase Ping Timeout (10s)")), 10000)
        );

        await Promise.race([pingPromise, timeoutPromise]);
        console.log(`[Firebase v4.12] Access Verified for Project: ${projectId}`);
        dbHasPermission = true;
        initSummary.push({ project: projectId, dbId, status: "success" });
      } catch (writeErr: any) {
        if (writeErr.message && writeErr.message.includes("PERMISSION_DENIED")) {
          dbHasPermission = false;
        }
        console.warn(`[Firebase v4.12] Access Verification Warning: ${writeErr.message}`);
        initSummary.push({ project: projectId, dbId, status: "warning", error: writeErr.message });
        
        // Try a simple read as fallback
        try {
          await db.collection("_system_check").limit(1).get();
          dbHasPermission = true;
        } catch (readErr: any) {
          if (readErr.message && readErr.message.includes("PERMISSION_DENIED")) {
            dbHasPermission = false;
          }
          console.error(`[Firebase v4.12] Full Connection Failure: ${readErr instanceof Error ? readErr.message : String(readErr)}`);
        }
      }
    })();

    console.log(`[Firebase v4.12] App Initialized (Connection check running in background)`);
    
    // SMTP Diagnostic
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.warn("[Email Startup] SMTP_USER or SMTP_PASS is missing! Emails will not be sent.");
    } else {
      console.log(`[Email Startup] SMTP configured for user: ${process.env.SMTP_USER}`);
      transporter.verify((error, success) => {
        if (error) console.error("[Email Startup] SMTP Connection Error:", error);
        else console.log("[Email Startup] SMTP Connection Verified - Server is ready to send emails.");
      });
    }

    // Stripe Diagnostic
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      console.warn("[Stripe Startup] STRIPE_WEBHOOK_SECRET is missing! Webhooks will fail signature verification.");
    } else {
      console.log("[Stripe Startup] STRIPE_WEBHOOK_SECRET is configured.");
    }
  } catch (e: any) {
    console.error(`[Firebase v4.12] FATAL Initialization Failure: ${e.message}`);
    initSummary.push({ project: projectId, dbId, status: "failed", error: e.message });
    db = null;
  }
}

let stripeClient: Stripe | null = null;

function getStripe() {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key || key === "sk_test_...") {
      throw new Error("STRIPE_SECRET_KEY is not set. Please configure it in AI Studio Settings.");
    }
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

function generateCouponCode(length: number = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Removed ambiguous O, 0, I, 1
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function handleSuccessfulPayment(session: Stripe.Checkout.Session) {
  const { app, userId, type, selectedPoolSessionId, couponCount } = session.metadata || {};
  let sessionDateStr = "TBC";
  let sData: any = null;

  // Ignore events that don't belong to this specific app
  if (app !== "pbcc-new") {
    console.log(`[Stripe Sync] Ignoring event from another app (app=${app})`);
    return { ignored: true };
  }

  if (userId && type) {
    console.log(`[Stripe Sync] Processing payment: User=${userId}, Type=${type}`);
    
    // Check if we already recorded this to avoid duplicates (Firebase)
    if (db) {
      try {
        const existingPayment = await db.collection("payments").where("stripeSessionId", "==", session.id).get();
        if (!existingPayment.empty) {
          console.log(`[Stripe Sync] Payment ${session.id} already recorded in Firebase. Skipping.`);
        } else {
          // Record it later in the function
        }
      } catch (e) {
        console.warn("[Firebase Sync] Could not check for existing payment.");
      }
    }

    const userRef = db ? db.collection("users").doc(userId) : null;
    let userDocExists = false;
    if (userRef) {
      const userDoc = await userRef.get();
      userDocExists = userDoc.exists;
    }
    
    if (type === "pool_session") {
      if (userRef && userDocExists) {
        const userData = (await userRef.get()).data();
        if (userData?.onboardingStatus === "beginner_pending_payment" || 
            userData?.onboardingStatus === "none" || 
            !userData?.onboardingStatus) {
          const updateData = { 
            onboardingStatus: "beginner_paid", 
            role: userData?.role === "member" ? "member" : "future_member",
            poolApprovalDate: admin.firestore.FieldValue.serverTimestamp() 
          };
          await userRef.update(updateData);
        }
      }

      if (supabaseAdmin) {
        const { error: upsertError } = await supabaseAdmin.from("profiles").upsert({ 
          id: userId,
          onboarding_status: "beginner_paid", 
          role: "future_member",
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
        if (upsertError) console.error(`[Supabase Upsert Error] ${upsertError.message || JSON.stringify(upsertError)}`);
      }

      if (selectedPoolSessionId) {
        if (db) {
          const sessionRef = db.collection("events").doc(selectedPoolSessionId);
          const sessionDoc = await sessionRef.get();
          if (sessionDoc.exists) {
            sData = sessionDoc.data();
            const participants = sData?.participants || [];
            if (!participants.includes(userId)) {
              await sessionRef.update({
                participants: [...participants, userId]
              });
            }
            // Save booked session date to user profile for leaders to see
            if (userRef && sData.date) {
              await userRef.update({
                bookedSessionId: selectedPoolSessionId,
                bookedSessionDate: sData.date
              });
            }
          }
        }
        
        // Supabase update (independent of firebase db state)
        if (supabaseAdmin) {
          await supabaseAdmin.rpc('append_participant', { event_id: selectedPoolSessionId, user_id: userId });
          if (!sData) {
            // If we didn't get data from firebase, try to get it from supabase for the email
            const { data: supEvent } = await supabaseAdmin.from('events').select('*').eq('id', selectedPoolSessionId).single();
            if (supEvent) {
              sData = {
                date: supEvent.date,
                location: supEvent.location,
                locationAddress: supEvent.location_address
              };
            }
          }
        }

        if (sData) {
          const sDate = sData.date?.toDate ? sData.date.toDate() : sData.date;
          if (sDate) {
            sessionDateStr = new Date(sDate).toLocaleDateString('en-GB', { 
              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });
          }
        }
      }
    } else if (type === "membership") {
      const expiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      if (userRef && userDocExists) {
        await userRef.update({ 
          onboardingStatus: "membership_paid", 
          role: "member", 
          memberSince: admin.firestore.FieldValue.serverTimestamp(),
          expiresOn: admin.firestore.Timestamp.fromDate(expiry)
        });
      }
      if (supabaseAdmin) {
        const { error: upsertError } = await supabaseAdmin.from("profiles").upsert({ 
          id: userId,
          onboarding_status: "membership_paid", 
          role: "member",
          membership_expiry: expiry.toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
        if (upsertError) console.error(`[Supabase Membership Sync Error] ${upsertError.message || JSON.stringify(upsertError)}`);
      }
    } else if (type === "beginner_course") {
      if (userRef && userDocExists) {
        await userRef.update({ onboardingStatus: "beginner_paid" });
      }
      if (supabaseAdmin) {
        const { error: upsertError } = await supabaseAdmin.from("profiles").upsert({ 
          id: userId,
          onboarding_status: "beginner_paid",
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
        if (upsertError) console.error(`[Supabase Course Sync Error] ${upsertError.message || JSON.stringify(upsertError)}`);
      }
    }
 else if (type === "boat_rental") {
      const { boatId, dates, extras } = session.metadata || {};
      if (db) {
        await db.collection("rentals").add({
          userId,
          boatId,
          dates,
          extras,
          amount: session.amount_total ? session.amount_total / 100 : 0,
          status: "paid",
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      // --- SUPABASE RENTAL SYNC ---
      if (supabaseAdmin) {
        try {
          const [startStr, endStr] = (dates || "").split(" to ");
          
          // Resolve Supabase ID from Firebase ID
          let supBoatId: any = parseInt(boatId || "0");
          if (isNaN(supBoatId) || supBoatId === 0) {
             const { data: boatMatch } = await supabaseAdmin.from('boats').select('id').eq('firebase_id', boatId).maybeSingle();
             if (boatMatch) supBoatId = boatMatch.id;
          }

          const { error: rentErr } = await supabaseAdmin
            .from("rentals")
            .insert({
              user_id: userId,
              boat_id: supBoatId,
              start_date: startStr || null,
              end_date: endStr || null,
              status: "paid",
              amount: session.amount_total ? session.amount_total / 100 : 0
            });
          if (rentErr) console.error(`[Supabase Rental Sync Error] Code: ${rentErr.code} | Message: ${rentErr.message} | Details: ${rentErr.details} | Full: ${JSON.stringify(rentErr)}`);
          else console.log("[Supabase Sync] Rental recorded successfully.");
        } catch (e) {
          console.error("[Supabase Rental Fatal Error]", e);
        }
      }
    }
 else if (type === "coupon_purchase") {
      const count = parseInt(session.metadata?.couponCount || "1");
      if (userRef && userDocExists) {
        await userRef.update({
          childCoupons: admin.firestore.FieldValue.increment(count)
        });
      }
    } else if (type === "club_coupons") {
      const count = parseInt(couponCount || "5");
      const couponType = session.metadata?.couponType || "club"; // "club" for adult, "child" for child
      const codes: string[] = [];
      if (db) {
        const batch = db.batch();
        for (let i = 0; i < count; i++) {
          const code = generateCouponCode();
          codes.push(code);
          const couponRef = db.collection("coupons").doc();
          batch.set(couponRef, {
            code,
            type: couponType, // will be 'club' or 'child'
            used: false,
            ownerId: userId,
            batchId: session.id,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            description: `Batch purchase (${couponType}) from ${session.customer_email || "Club"}`
          });
        }
        await batch.commit();
      }

      // Send the codes directly in the email as requested
      const userEmail = session.customer_email || session.metadata?.userEmail;
      if (userEmail) {
        const cType = couponType === "child" ? "Child" : "Adult";
        const emailSubject = "PBCC: Your Assessment Codes are Ready!";
        const emailHtml = `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px;">
            <h1 style="color: #059669;">Codes Ready</h1>
            <p>Thank you for your purchase of <b>${count} ${cType}</b> assessment codes. Here are your codes:</p>
            <div style="background: #f8fafc; padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px dashed #cbd5e1;">
              <ul style="margin: 0; padding-left: 20px; line-height: 2;">
                ${codes.map(c => `<li style="font-family: monospace; font-weight: bold; font-size: 1.2rem;">${c}</li>`).join("")}
              </ul>
            </div>
            <p>You can also access and manage these codes anytime via the Partner Portal:</p>
            <a href="${process.env.APP_URL}/dashboard/club" style="display: inline-block; background: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Go to Partner Portal</a>
            <p style="margin-top: 20px; font-size: 14px; color: #64748b;">Give these codes to your members so they can book their pool session assessments on our site at no extra cost to them.</p>
          </div>
        `;
        await sendEmail({ to: userEmail, subject: emailSubject, html: emailHtml });
      }
    }

    // RECORD IN PAYMENTS COLLECTION (FIREBASE)
    if (db) {
      try {
        await db.collection("payments").add({
          uid: userId,
          userEmail: session.customer_email || session.metadata?.userEmail || "unknown@stripe.com",
          amount: session.amount_total ? session.amount_total / 100 : 0,
          type: type,
          status: "completed",
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          stripeSessionId: session.id,
          description: `Stripe Sync: ${type}`
        });
      } catch (e) {
        console.warn("[Firebase Sync] Failed to record payment record.");
      }
    }

    // --- SUPABASE SYNC (NEW) ---
    if (supabaseAdmin) {
      try {
        const { error: supError } = await supabaseAdmin
          .from("payments")
          .insert({
            user_id: userId,
            user_email: session.customer_email || session.metadata?.userEmail || "unknown@stripe.com",
            amount: session.amount_total ? session.amount_total / 100 : 0,
            type: type,
            status: "completed",
            stripe_session_id: session.id,
            description: `Stripe Sync: ${type}`
          });
        
        if (supError) console.error(`[Supabase Payment Sync Error] ${supError.message || JSON.stringify(supError)}`);
        else console.log("[Supabase Sync] Payment recorded successfully.");
      } catch (e) {
        console.error("[Supabase Fatal Error]", e);
      }
    }

    // EMAILS (Non-blocking to avoid Stripe timeout or client hang)
    const userEmail = session.customer_email || session.metadata?.userEmail;
    if (userEmail) {
      // We don't await these to prevent blocking the response
      (async () => {
        try {
          let userSubject = "";
          let userHtml = "";
          let adminEmail = "";
          let adminSubject = "";
          let adminHtml = "";

          if (type === "pool_session") {
            userSubject = "PBCC: Pool Session Booking Confirmed!";
            userHtml = `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px;">
                <h1 style="color: #059669;">Booking Confirmed</h1>
                <p>Thank you for booking your pool session assessment. We have received your payment and your space is reserved.</p>
                
                <div style="background: #f8fafc; padding: 15px; border-radius: 12px; margin: 20px 0;">
                  <p style="margin: 5px 0;"><b>Date:</b> ${sessionDateStr}</p>
                  <p style="margin: 5px 0;"><b>Location:</b> ${sData?.location || "Putney Leisure Centre"}</p>
                  ${sData?.locationAddress ? `<p style="margin: 5px 0;"><b>Address:</b> ${sData.locationAddress}</p>` : ""}
                </div>

                <p>You can view your booking details and manage your profile here:</p>
                <a href="${process.env.APP_URL}/onboarding" style="display: inline-block; background: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">View My Dashboard</a>

                <p style="margin-top: 30px; font-size: 14px; color: #64748b;">We look forward to seeing you at the pool!</p>
              </div>
            `;
            adminEmail = "pool@putneybridgecc.co.uk";
            adminSubject = "New Pool Session Booking";
            adminHtml = `
              <p><b>${userEmail}</b> has booked a pool session assessment.</p>
              <p><b>Date:</b> ${sessionDateStr}</p>
            `;
          } else if (type === "membership") {
            userSubject = "Welcome to Putney Bridge Canoe Club!";
            userHtml = `<h1>Membership Confirmed</h1><p>Welcome! Your membership is active.</p>`;
            adminSubject = "New Membership Subscription";
            adminHtml = `<p><b>${userEmail}</b> has paid for a membership.</p>`;
          } else if (type === "boat_rental") {
            const { boatName, dates } = session.metadata || {};
            userSubject = "PBCC: Boat Rental Confirmed!";
            userHtml = `<h1>Rental Confirmed</h1><p>You have successfully rented a boat: <b>${boatName}</b> for ${dates}.</p>`;
            adminSubject = `New Boat Rental: ${boatName}`;
            adminHtml = `<p><b>${userEmail}</b> has rented <b>${boatName}</b> for dates: ${dates}.</p>`;
          } else if (type === "club_coupons") {
            const cType = session.metadata?.couponType === "child" ? "Child" : "Adult";
            const cCount = session.metadata?.couponCount || "5";
            userSubject = "PBCC: Your Assessment Codes are Ready!";
            userHtml = `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px;">
                <h1 style="color: #059669;">Codes Ready</h1>
                <p>Thank you for your purchase of <b>${cCount} ${cType}</b> assessment codes.</p>
                <p>You can access your codes immediately via the Partner Portal:</p>
                <a href="${process.env.APP_URL}/dashboard/club" style="display: inline-block; background: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Go to Partner Portal</a>
                <p style="margin-top: 20px; font-size: 14px; color: #64748b;">These codes allow your members to book pool session assessments on our site.</p>
              </div>
            `;
            adminEmail = "finance@putneybridgecc.co.uk";
            adminSubject = "New Partner Club Coupon Purchase";
            adminHtml = `<p><b>${userEmail}</b> purchased ${cCount} ${cType} codes.</p>`;
          }

          if (userSubject) await sendEmail({ to: userEmail, subject: userSubject, html: userHtml });
          if (adminEmail) await sendEmail({ to: adminEmail, subject: adminSubject, html: adminHtml });
        } catch (e) {
          console.error("[Stripe Email Error] Fire-and-forget email failed:", e);
        }
      })();
    }

    return { success: true };
  }
}

async function ensurePbccWebIsAdmin() {
  const targetEmail = "pbcc.web@gmail.com";
  console.log(`[Admin Healing] Automatically verifying and restoring admin role for ${targetEmail}...`);

  if (db && dbHasPermission) {
    try {
      const usersRef = db.collection("users");
      const snapshot = await usersRef.where("email", "==", targetEmail).get();
      if (!snapshot.empty) {
        for (const userDoc of snapshot.docs) {
          const currentData = userDoc.data();
          if (currentData.role !== "admin" || currentData.onboardingStatus !== "membership_paid") {
            await userDoc.ref.update({
              role: "admin",
              onboardingStatus: "membership_paid"
            });
            console.log(`[Admin Healing] SUCCESSFULLY restored Firebase role to "admin" and status to "membership_paid" for user uid: ${userDoc.id}`);
          } else {
            console.log(`[Admin Healing] Firebase role is already "admin" and status is "membership_paid" for user uid: ${userDoc.id}`);
          }
        }
      } else {
        console.warn(`[Admin Healing] Firestore: No user document found for ${targetEmail}.`);
      }
    } catch (e: any) {
      if (e.message && e.message.includes("PERMISSION_DENIED")) {
        console.warn(`[Admin Healing] Firestore PERMISSION_DENIED: Server-side Admin SDK lacks IAM permissions to write to your custom Firestore project ("${firebaseConfig?.projectId || 'unknown'}"). This is expected when running in AI Studio with a custom Firebase project. Admin role check is falling back entirely to Supabase, which is fully operational.`);
        dbHasPermission = false;
      } else {
        console.error("[Admin Healing] Firestore error:", e.message);
      }
    }
  } else {
    console.log(`[Admin Healing] Firestore is unconfigured or lacks server-side write permissions. Skipping Firestore check, falling back entirely to Supabase.`);
  }

  if (supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("id, role, onboarding_status")
        .eq("email", targetEmail);

      if (error) throw error;

      if (data && data.length > 0) {
        for (const profile of data) {
          if (profile.role !== "admin" || profile.onboarding_status !== "membership_paid") {
            const { error: updateErr } = await supabaseAdmin
              .from("profiles")
              .update({ role: "admin", onboarding_status: "membership_paid" })
              .eq("id", profile.id);

            if (updateErr) {
              console.error(`[Admin Healing] Supabase update failed for ${profile.id}:`, updateErr.message);
            } else {
              console.log(`[Admin Healing] SUCCESSFULLY restored Supabase role to "admin" and status to "membership_paid" for profile id: ${profile.id}`);
            }
          } else {
            console.log(`[Admin Healing] Supabase role is already "admin" and status is "membership_paid" for profile id: ${profile.id}`);
          }
        }
      } else {
        console.warn(`[Admin Healing] Supabase: No profile found for ${targetEmail}.`);
      }
    } catch (e: any) {
      console.error("[Admin Healing] Supabase error:", e.message);
    }
  }
}

async function startServer() {
  await initializeFirebase();
  
  // Call immediately and also with delay to allow background DB checks to complete
  ensurePbccWebIsAdmin().catch(err => console.error("[Admin Healing System] Init error:", err));
  setTimeout(() => {
    ensurePbccWebIsAdmin().catch(err => console.error("[Admin Healing System] Delayed init error:", err));
  }, 5000);

  const app = express();
  const PORT = 3000;

  // Global Logger
  app.use((req, res, next) => {
    console.log(`[Server v4.12] ${req.method} ${req.url}`);
    next();
  });

  app.use((req, res, next) => {
    if (req.originalUrl === "/api/webhook") {
      next();
    } else {
      express.json({ limit: "50mb" })(req, res, next);
    }
  });
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // API routes
  app.post("/api/webhook", express.raw({ type: "*/*" }), async (req, res) => {
    const timestamp = new Date().toISOString();
    console.log(`[Webhook v2.5] Incoming ${req.method} request from ${req.ip}`);
    
    const sig = req.headers["stripe-signature"];
    const contentType = req.headers["content-type"];
    console.log(`[Webhook v2.5] Content-Type: ${contentType}, Signature Present: ${!!sig}`);
    const rawSecrets = process.env.STRIPE_WEBHOOK_SECRET || "";
    const webhookSecrets = rawSecrets.split(",").map(s => s.trim()).filter(Boolean);

    // Create a log entry first
    let logDoc: any = null;
    if (db) {
      try {
        logDoc = await db.collection("webhook_logs").add({
          timestamp,
          method: req.method,
          hasSignature: !!sig,
          secretsCount: webhookSecrets.length,
          headers: req.headers,
          status: "receiving"
        });
      } catch (e) {
        console.error("[Webhook Log Error] Failed to write to Firestore:", e);
      }
    }

    if (!sig || webhookSecrets.length === 0) {
      console.warn("Webhook signature or secret missing. Skipping verification.");
      if (logDoc) await logDoc.update({ status: "error", error: "Missing signature or configured secret" });
      return res.status(400).send("Webhook Error: Missing signature or secret");
    }

    let event: Stripe.Event | null = null;
    let lastError: any = null;

    try {
      const stripe = getStripe();
      for (const secret of webhookSecrets) {
        try {
          event = stripe.webhooks.constructEvent(req.body, sig, secret);
          if (event) {
            console.log(`[Webhook] Verified successfully with secret starting ${secret.substring(0, 8)}...`);
            break;
          }
        } catch (err: any) {
          lastError = err;
        }
      }

      if (!event) {
        console.error(`[Webhook Verification Failed] Tried ${webhookSecrets.length} secret(s). Last error: ${lastError?.message}`);
        console.log(`[Webhook Verification Failed] Signature: ${sig?.toString().substring(0, 20)}...`);
        console.log(`[Webhook Verification Failed] Body length: ${req.body?.length || 0}`);
        if (logDoc) await logDoc.update({ status: "error", error: `Verification failed for all secrets. Last: ${lastError?.message}` });
        return res.status(400).type('json').send(JSON.stringify({ error: `Verification failed. ${lastError?.message}` }));
      }

      if (logDoc) await logDoc.update({ status: "verified", eventType: event.type });
    } catch (err: any) {
      console.error(`[Webhook Setup Error] ${err.message}`);
      if (logDoc) await logDoc.update({ status: "error", error: err.message });
      return res.status(500).send(`Webhook Setup Error: ${err.message}`);
    }

    // Handle the event
    try {
      if (event && event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        
        // Respond to Stripe IMMEDIATELY to avoid timeouts
        res.json({ received: true, status: "processing" });

        // Process in background
        (async () => {
          try {
            console.log(`[Webhook Background] Processing session: ${session.id}`);
            const syncResult = await handleSuccessfulPayment(session);
            if (logDoc) await logDoc.update({ status: "processed", syncResult, updatedAt: new Date().toISOString() });
            console.log(`[Webhook Background] Successfully processed: ${session.id}`);
          } catch (processErr: any) {
            console.error(`[Webhook Background Error] ${processErr.message}`);
            if (logDoc) await logDoc.update({ status: "failed", error: processErr.message, updatedAt: new Date().toISOString() });
          }
        })();
      } else {
        if (logDoc) await logDoc.update({ status: "ignored", eventType: event.type });
        res.json({ received: true, status: "ignored" });
      }
    } catch (err: any) {
      console.error(`[Webhook Error] Setup failed: ${err.message}`);
      if (logDoc) await logDoc.update({ status: "failed", error: err.message });
      if (!res.headersSent) {
        res.status(500).send(`Internal Server Error: ${err.message}`);
      }
    }
  });

  // Routes handled after body parsing
  // Send Welcome Email to Partner
  app.post("/api/partner/welcome", async (req, res) => {
    const { email, firstName, clubName } = req.body;
    if (!email) return res.status(400).json({ error: "Email target required" });

    // Send the response immediately to avoid hanging, and send the email in background
    res.json({ success: true, message: "Welcome email processing" });

    (async () => {
      try {
        await sendEmail({
          to: email,
          subject: "Welcome to the PBCC Partner Program!",
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px;">
              <h1 style="color: #059669;">Welcome, ${firstName || 'Partner'}!</h1>
              <p>Thank you for partnering with Putney Bridge Canoe Club on behalf of <b>${clubName || 'your club'}</b>.</p>
              <p>Your account is now activated. As a partner, you can:</p>
              <ul style="line-height: 1.6;">
                <li>Purchase batches of Assessment Coupons for your members.</li>
                <li>Track which members have used their codes.</li>
                <li>Manage your club's profile and contact details.</li>
              </ul>
              <div style="background: #f8fafc; padding: 15px; border-radius: 12px; margin: 20px 0;">
                <p><b>How to use codes:</b> Once you purchase a batch, you'll receive a list of unique codes. Give one code to a member. They can enter it during their registration on our site to book a pool session for free.</p>
              </div>
              <a href="${process.env.APP_URL}/dashboard/club" style="display: inline-block; background: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Access Your Partner Portal</a>
              <p style="margin-top: 30px; font-size: 14px; color: #64748b;">If you need help, reply to this email or contact our finance team.</p>
            </div>
          `
        });
      } catch (error: any) {
        console.error("[Partner Welcome Email Error]", error);
      }
    })();
  });

  // Re-send existing coupons to partner
  app.post("/api/partner/email-coupons", async (req, res) => {
    const { email, codes, clubName } = req.body;
    if (!email || !codes || !Array.isArray(codes)) {
      return res.status(400).json({ error: "Invalid request. Email and codes array required." });
    }

    try {
      await sendEmail({
        to: email,
        subject: `PBCC: Your Assessment Codes List - ${clubName}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px;">
            <h2 style="color: #059669;">Ongoing Assessment Codes</h2>
            <p>Hello, here is the list of unused assessment codes for <b>${clubName}</b> as requested:</p>
            <div style="background: #f1f5f9; padding: 20px; border-radius: 12px; margin: 20px 0;">
              <ul style="margin: 0; padding-left: 20px; line-height: 2;">
                ${codes.map(c => `<li style="font-family: monospace; font-weight: bold; font-size: 1.1rem;">${c}</li>`).join("")}
              </ul>
            </div>
            <p>You can see the full status of all your codes (including used ones) in the portal:</p>
            <a href="${process.env.APP_URL}/dashboard/club" style="display: inline-block; background: #059669; color: white; padding: 10px 20px; text-decoration: none; border-radius: 8px;">Portal Dashboard</a>
          </div>
        `
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Manual Issue Coupons (Admin/Finance)
  app.post("/api/admin/issue-manual-coupons", async (req, res) => {
    console.log("[Admin] Manual coupon issue request received:", req.body);
    const { targetUserId, targetUserEmail, count, type, bankReference } = req.body;
    if (!targetUserId || !count || !type) {
      console.warn("[Admin] Missing parameters in manual issue:", req.body);
      return res.status(400).json({ error: "Missing parameters (targetUserId, count, type)" });
    }

    try {
      const codes: string[] = [];
      if (db) {
        const batch = db.batch();
        for (let i = 0; i < count; i++) {
          const code = generateCouponCode();
          codes.push(code);
          const couponRef = db.collection("coupons").doc();
          batch.set(couponRef, {
            code,
            type,
            used: false,
            ownerId: targetUserId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            description: `Manual issue (${type}) - Ref: ${bankReference || 'None'}`,
            bankReference: bankReference || null
          });
        }
        await batch.commit();

        // Record the manual transaction
        await db.collection("payments").add({
          uid: targetUserId,
          userEmail: targetUserEmail,
          amount: 0, // Manual issues might be zero or recorded elsewhere
          type: "manual_coupon_issue",
          description: `Manual ${type} coupons x${count}. Ref: ${bankReference}`,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          status: "completed"
        });
      }

      // Send email to the partner
      if (targetUserEmail) {
        await sendEmail({
          to: targetUserEmail,
          subject: "PBCC: Assessment Codes Issued (Manual/Bank Transfer)",
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px;">
              <h1 style="color: #059669;">Codes Issued</h1>
              <p>We have manually issued <b>${count} ${type === "child" ? "Child" : "Adult"}</b> assessment codes to your account following your bank transfer/manual payment.</p>
              <p><b>Reference:</b> ${bankReference || "N/A"}</p>
              <div style="background: #f8fafc; padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px dashed #cbd5e1;">
                <ul style="margin: 0; padding-left: 20px; line-height: 2;">
                  ${codes.map(c => `<li style="font-family: monospace; font-weight: bold; font-size: 1.2rem;">${c}</li>`).join("")}
                </ul>
              </div>
              <p>These codes are now active in your Partner Portal.</p>
              <a href="${process.env.APP_URL}/dashboard/club" style="display: inline-block; background: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Go to Partner Portal</a>
            </div>
          `
        });
      }

      res.json({ success: true, count, codes });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API health check
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      firebase: db ? "connected" : "disconnected",
      supabase: supabaseAdmin ? "ready" : "missing",
      initSummary 
    });
  });

  // Admin Manual Verification
  app.post("/api/admin/verify-payment", async (req, res) => {
    const { sessionId, userId } = req.body;
    console.log(`[Admin Sync] Attempting manual verify for session ${sessionId} (Admin: ${userId})`);

    try {
      // 1. Verify user is admin (Firebase or Supabase check)
      let isAdmin = false;

      if (db) {
        try {
          const adminRef = db.collection("users").doc(userId);
          const adminDoc = await adminRef.get();
          if (adminDoc.exists) {
            const data = adminDoc.data();
            if (data?.role === "admin" || data?.role === "financial" || data?.email === "pbcc.web@gmail.com") {
              isAdmin = true;
            }
          }
        } catch (e) {
          console.warn("[Admin Sync] Firebase admin check failed, falling back to Supabase.");
        }
      }

      if (!isAdmin && supabaseAdmin) {
        try {
          const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("role, email")
            .eq("id", userId)
            .single();
          if (profile && (profile.role === "admin" || profile.role === "financial" || profile.email === "pbcc.web@gmail.com")) {
            isAdmin = true;
          }
        } catch (e) {
          console.error("[Admin Sync] Supabase admin check failed.");
        }
      }

      if (!isAdmin) {
        return res.status(403).type('json').send(JSON.stringify({ error: "Access denied. Only admins or financial roles can sync." }));
      }

      // 2. Fetch from Stripe
      const stripe = getStripe();
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      if (session.payment_status === "paid" || session.status === "complete") {
        const result = await handleSuccessfulPayment(session);
        return res.status(200).type('json').send(JSON.stringify({ status: "success", result }));
      } else {
        return res.status(400).type('json').send(JSON.stringify({ error: "Session not paid.", stripeStatus: session.payment_status }));
      }
    } catch (error: any) {
      console.error("[Admin Sync Error]", error);
      res.status(500).type('json').send(JSON.stringify({ error: error.message }));
    }
  });

  // System Check
  app.get("/api/admin/system-check", async (req, res) => {
    try {
      const activeApp = admin.app();
      
      // Check Supabase
      let supabaseStatus = "not_configured";
      if (supabaseAdmin) {
        const { data, error } = await supabaseAdmin.from("profiles").select("count", { count: "exact", head: true });
        supabaseStatus = error ? `error: ${error.message}` : "connected";
      }

      const report = {
        status: db ? "active" : "disconnected",
        v: "4.7",
        project: admin.app().options.projectId,
        dbId: firebaseConfig.firestoreDatabaseId || "(default)",
        auth: !!admin.auth(),
        supabase: supabaseStatus,
        initSummary,
        timestamp: new Date().toISOString()
      };

      console.log("[System Check v4.12] Diagnostic Info:", JSON.stringify(report));
      
      // Try to write a trace to Firebase if available
      try {
        if (db) {
          await db.collection("_system_check").doc("api_ping").set({ 
            ...report,
            identity: "admin-sdk-v4.12"
          });
        }
      } catch (e) {
        console.warn("[System Check] Could not write trace to Firebase.");
      }
      
      res.json({ 
        status: (db !== null || supabaseStatus === "connected") ? "success" : "failed", 
        ...report
      });
    } catch (error: any) {
      console.error("[System Check Error]", error);
      res.status(500).json({ 
        error: error.message,
        code: error.code,
        v: "4.12",
        initSummary,
        activeProject: admin.app()?.options?.projectId,
        databaseId: firebaseConfig.firestoreDatabaseId || "(default)"
      });
    }
  });

  // Fetch session data for Hybrid Sync (Client-side sync fallback)
  app.get("/api/admin/stripe-session-data", async (req, res) => {
    const { sessionId } = req.query;
    if (!sessionId) return res.status(400).json({ error: "Session ID required" });

    try {
      const stripe = getStripe();
      const session = await stripe.checkout.sessions.retrieve(sessionId as string);
      res.json({ session });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Stripe Checkout Session
  app.post("/api/create-checkout-session", async (req, res) => {
    const { type, userId, userEmail } = req.body;
    console.log(`[Stripe v4.12] POST /api/create-checkout-session - Type: ${type}, User: ${userId}, Email: ${userEmail}`);
    
    const APP_URL = process.env.APP_URL || "http://localhost:3000";
    
    let amount = 0;
    let name = "";

    try {
      if (type === "pool_session") {
        if (req.body.amount) {
          amount = Math.round(Number(req.body.amount));
        } else {
          amount = 1000;
        }
        name = "Kayaking Pool Session Registration";
      } else if (type === "membership") {
        amount = 5000;
        name = "Annual Kayaking Club Membership";
      } else if (type === "boat_rental") {
        amount = Math.round(Number(req.body.amount));
        name = `Boat Rental: ${req.body.boatName} (${req.body.dates})`;
      } else if (type === "coupon_purchase") {
        const count = Number(req.body.couponCount) || 1;
        amount = count * 500;
        name = `${count}x Child Pool Session Coupons`;
      } else if (type === "club_coupons") {
        const count = Number(req.body.couponCount) || 5;
        const couponTypeTarget = req.body.couponType || "club";
        const pricePerUnit = couponTypeTarget === "child" ? 500 : 1000;
        amount = count * pricePerUnit;
        name = `Batch of ${count} Pool Session Coupons (${couponTypeTarget === "child" ? "Child" : "Adult"})`;
      }

      if (!amount || amount <= 0) {
        console.error(`[Stripe v4.12] Error: Invalid amount ${amount} for type ${type}`);
        return res.status(400).json({ error: `Invalid payment amount (${amount}).` });
      }

      const stripe = getStripe();
      const publishableKey = process.env.VITE_STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_Publishable_key;
      
      console.log(`[Stripe v4.12] Initializing stripe.checkout.sessions.create...`);

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "gbp",
              product_data: { name },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        success_url: `${APP_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}&type=${type}&amount=${amount / 100}`,
        cancel_url: `${APP_URL}${type === "boat_rental" ? "/boats" : "/onboarding"}`,
        customer_email: userEmail,
        metadata: { 
          app: "pbcc-new",
          userId, 
          type,
          selectedPoolSessionId: req.body.selectedPoolSessionId ? String(req.body.selectedPoolSessionId) : "",
          boatId: req.body.boatId ? String(req.body.boatId) : "",
          dates: req.body.dates ? String(req.body.dates) : "",
          extras: req.body.extras ? String(req.body.extras) : "",
          couponCount: (req.body.couponCount || "").toString(),
          couponType: req.body.couponType || "club"
        },
      });

      console.log(`[Stripe v4.12] Session created: ${session.id}`);
      return res.json({ 
        id: session.id, 
        url: session.url,
        publishableKey 
      });
    } catch (error: any) {
      console.error("[Stripe v4.12] FATAL API EXCEPTION:", error);
      return res.status(500).json({ 
        error: error.message,
        v: "4.12",
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined
      });
    }
  });

  // --- TRIAL COUPON ISSUANCE (Leader Action) ---
  app.post("/api/leader/issue-trial", async (req, res) => {
    const { userId, userEmail, userName, instructorName } = req.body;
    if (!userId || !userEmail) return res.status(400).json({ error: "Missing user info" });

    try {
      const code = `TRIAL-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      
      // 1. Create Coupon in Firestore
      if (db) {
        await db.collection("coupons").add({
          code,
          type: "custom",
          used: false,
          ownerId: userId,
          description: "New Recruit Trial Session",
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      // 2. Send "Email"
      await sendEmail({
        to: userEmail,
        subject: "PBCC: Your Trial Session Approval",
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px;">
            <h1 style="color: #059669;">Welcome to Putney Bridge Canoe Club!</h1>
            <p>Hi ${userName},</p>
            <p>A club leader (${instructorName}) has assessed your pool session or experience and approved you for a <b>Free Trial Session</b>.</p>
            <p>You can use the following coupon code to book your next river tour or pool session for free:</p>
            <div style="background: #f1f5f9; padding: 20px; border-radius: 12px; text-align: center; margin: 20px 0;">
              <span style="font-family: monospace; font-size: 24px; font-bold; color: #1e293b; letter-spacing: 2px;">${code}</span>
            </div>
            <p>Simply enter this code in the "Coupon Code" field when booking your next event.</p>
            <p>Once you've completed your trial sessions and feel ready, you can return to the club website to complete your full membership.</p>
            <a href="${process.env.APP_URL}/events" style="display: inline-block; background: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 20px;">Browse Upcoming Events</a>
          </div>
        `
      });

      res.json({ success: true, code });
    } catch (error: any) {
      console.error("[Issue Trial Error]", error);
      res.status(500).json({ error: error.message });
    }
  });

  // --- EXPERIENCED PADDLER CONTACT ---
  app.post("/api/contact/experienced", async (req, res) => {
    const { name, email, phone, yearsPaddling, experience } = req.body;
    
    if (!name || !email || !experience) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    try {
      // Using both just in case, but Putney is the correct club name
      const adminEmail = "info@putneybridgecc.co.uk";
      const altEmail = "info@putnetbridgecc.co.uk";
      
      const subject = `Experienced Paddler Inquiry: ${name}`;
      const html = `
        <h3>Experienced Paddler Inquiry</h3>
        <p><b>Name:</b> ${name}</p>
        <p><b>Email:</b> ${email}</p>
        <p><b>Phone:</b> ${phone}</p>
        <p><b>Years Paddling:</b> ${yearsPaddling}</p>
        <p><b>Experience Description:</b></p>
        <p>${experience}</p>
      `;

      await sendEmail({ to: adminEmail, subject, html });
      await sendEmail({ to: altEmail, subject, html });
      
      // Also log it to Firestore if available
      if (db) {
        await db.collection("inquiries").add({
          type: "experienced_paddler",
          name,
          email,
          phone,
          yearsPaddling,
          experience,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      res.json({ status: "success" });
    } catch (error: any) {
      console.error("[Experienced Contact Error]", error);
      res.status(500).json({ error: error.message });
    }
  });

  // --- NEW SOCIAL & LOGBOOK API ENDPOINTS ---

  // Get automated weather and River Thames flow levels
  app.get("/api/weather-flow", async (req, res) => {
    console.log("[API] /api/weather-flow triggered");
    let weather = { temp: 15, condition: "Partly Cloudy" };
    let flow = { level: "1.12m", flow: "0.8m³/s", status: "Low Flow" };
    
    try {
      const weatherRes = await fetch("https://api.open-meteo.com/v1/forecast?latitude=51.4678&longitude=-0.2114&current_weather=true");
      if (weatherRes.ok) {
        const weatherData: any = await weatherRes.json();
        const code = weatherData.current_weather?.weathercode || 0;
        const weatherCodes: { [key: number]: string } = {
          0: "Clear Sky", 1: "Mainly Clear", 2: "Partly Cloudy", 3: "Overcast",
          45: "Foggy", 48: "Depositing Rime Fog", 51: "Light Drizzle", 53: "Moderate Drizzle",
          61: "Light Rain", 63: "Moderate Rain", 65: "Heavy Rain", 71: "Light Snow",
          73: "Moderate Snow", 75: "Heavy Snow", 95: "Thunderstorm"
        };
        weather = {
          temp: Math.round(weatherData.current_weather?.temperature || 15),
          condition: weatherCodes[code] || "Partly Cloudy"
        };
      }
    } catch (err: any) {
      console.warn("[Weather Fetch Warning] Falling back to default weather details:", err.message);
    }

    try {
      // Station Richmond Lock E21856
      const riverRes = await fetch("https://environment.data.gov.uk/flood-monitoring/id/stations/E21856/measures");
      if (riverRes.ok) {
        const riverData: any = await riverRes.json();
        const latestValue = riverData.items?.[0]?.latestReading?.value || 1.15;
        flow = {
          level: `${latestValue.toFixed(2)}m`,
          flow: latestValue > 1.8 ? "1.5m³/s" : "0.7m³/s",
          status: latestValue > 2.0 ? "High Flow (Caution)" : latestValue > 1.4 ? "Medium Flow" : "Low Flow"
        };
      }
    } catch (err: any) {
      console.warn("[River Fetch Warning] Falling back to default river flow details:", err.message);
    }

    res.json({ weather, flow });
  });

  // Broadcast social newsletter to multiple members
  app.post("/api/social/send-newsletter", async (req, res) => {
    const { emails, subject, htmlContent } = req.body;
    if (!emails || !Array.isArray(emails) || emails.length === 0 || !subject || !htmlContent) {
      return res.status(400).json({ error: "Missing parameters: emails array, subject, htmlContent required" });
    }

    res.json({ success: true, message: `Newsletter broadcast processing in background for ${emails.length} members` });

    (async () => {
      console.log(`[Email Newsletter] Broadcasting to ${emails.length} recipients...`);
      let successCount = 0;
      let failCount = 0;
      for (const email of emails) {
        try {
          await sendEmail({
            to: email,
            subject,
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px;">
                ${htmlContent}
                <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
                <p style="font-size: 11px; color: #94a3b8; text-align: center;">
                  You are receiving this email because you are a registered member of Putney Bridge Canoe Club.<br />
                  <a href="${process.env.APP_URL || 'http://localhost:3000'}/profile" style="color: #059669; text-decoration: none;">Manage Subscriptions</a>
                </p>
              </div>
            `
          });
          successCount++;
        } catch (e: any) {
          console.error(`[Email Newsletter Error] Failed to send to ${email}:`, e.message);
          failCount++;
        }
      }
      console.log(`[Email Newsletter] Broadcast complete. Success: ${successCount}, Failed: ${failCount}`);
    })();
  });

  // Send interactive Mobile Logbook link to Leader
  app.post("/api/event/send-logbook-link", async (req, res) => {
    const { leaderEmail, eventId, eventTitle, eventDate, leaderName, participants } = req.body;
    if (!leaderEmail || !eventId || !eventTitle) {
      return res.status(400).json({ error: "Missing parameters: leaderEmail, eventId, eventTitle are required" });
    }

    try {
      const dashboardUrl = `${process.env.APP_URL || "http://localhost:3000"}/logbook/${eventId}`;
      const plist = Array.isArray(participants) ? participants : [];
      
      const html = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 20px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05);">
          <h2 style="color: #059669; font-style: italic; font-weight: 900;">PBCC Logbook Reminder 🛶</h2>
          <p>Hello <b>${leaderName || "Leader"}</b>,</p>
          <p>This is a reminder that you are leading the upcoming event: <b>${eventTitle}</b> on <b>${eventDate}</b>.</p>
          
          <h3 style="color: #1e293b; margin-top: 25px;">Roster Summary (${plist.length} paddlers):</h3>
          <div style="background: #f8fafc; padding: 15px; border-radius: 12px; border: 1px solid #e2e8f0; margin-bottom: 20px;">
            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
              <thead>
                <tr style="border-bottom: 1px solid #cbd5e1; color: #64748b;">
                  <th style="padding: 6px 0; text-align: left;">Name</th>
                  <th style="padding: 6px 0; text-align: left;">Role</th>
                  <th style="padding: 6px 0; text-align: left;">Status</th>
                  <th style="padding: 6px 0; text-align: left;">Reserved Boat</th>
                </tr>
              </thead>
              <tbody>
                ${plist.map((p: any) => {
                  const isBeginner = ["beginner_paid", "trial_active", "pending_leader_approval", "beginner_pending_payment"].includes(p.onboardingStatus);
                  const highlightStyle = isBeginner ? "background: #fef2f2; color: #991b1b; font-weight: bold; padding: 2px 6px; border-radius: 4px;" : "";
                  return `
                    <tr style="border-bottom: 1px solid #f1f5f9;">
                      <td style="padding: 8px 0;">${p.displayName}</td>
                      <td style="padding: 8px 0; color: #64748b; font-size: 11px;">${p.role}</td>
                      <td style="padding: 8px 0;"><span style="${highlightStyle}">${(p.onboardingStatus || 'none').replace('_', ' ')}</span></td>
                      <td style="padding: 8px 0; color: #0891b2;">${p.boatName || "None"}</td>
                    </tr>
                  `;
                }).join("")}
              </tbody>
            </table>
          </div>

          <p style="margin-bottom: 25px;">Before launching, you must complete the pre-trip safety details (modify boat choices, toggle present members, verify emergency details, and check automated river flow diagnostics).</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${dashboardUrl}" style="display: inline-block; background: #059669; color: white; padding: 14px 28px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 6px -1px rgb(5 150 105 / 0.2);">Open Mobile Logbook Dashboard</a>
          </div>
          
          <p style="font-size: 12px; color: #64748b; text-align: center; margin-top: 40px;">This dashboard is fully optimized for your mobile phone on the riverbank.</p>
        </div>
      `;

      await sendEmail({
        to: leaderEmail,
        subject: `PBCC Logbook Reminder: ${eventTitle}`,
        html
      });
      
      res.json({ success: true, message: "Logbook link emailed successfully to " + leaderEmail });
    } catch (error: any) {
      console.error("[Send Logbook Link Error]", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  const isProd = process.env.NODE_ENV === "production" || process.env.VITE_PROD === "true";
  
  if (!isProd) {
    try {
      console.log("[Server] Production mode NOT detected. Mounting Vite middleware...");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (viteErr: any) {
      console.error("[Server] Failed to start Vite middleware, falling back to static:", viteErr.message);
      // Fallback to static even in dev if vite fails (e.g. bundle size issues)
      const distPath = path.join(process.cwd(), "dist");
      if (fs.existsSync(distPath)) {
        app.use(express.static(distPath));
        app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
      }
    }
  } else {
    console.log("[Server] Production mode detected. Serving static files from /dist...");
    const distPath = path.join(process.cwd(), "dist");
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        const indexPath = path.join(distPath, "index.html");
        if (fs.existsSync(indexPath)) {
          res.sendFile(indexPath);
        } else {
          res.status(404).send("Production build not found (index.html missing in dist/). Please build the app.");
        }
      });
    } else {
      console.error("[Server] FATAL: /dist directory not found in production!");
      app.get("*", (req, res) => {
        res.status(500).send("Server Error: /dist directory missing. The application build might have failed.");
      });
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server v4.12] Running on port ${PORT} (NODE_ENV: ${process.env.NODE_ENV})`);
  });

  // Global API JSON Error Handler
  app.use("/api", (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(`[API Error Global] ${req.method} ${req.url}:`, err);
    res.status(err.status || 500).json({
      error: err.message || "Internal Server Error",
      path: req.path,
      timestamp: new Date().toISOString()
    });
  });
}

startServer().catch(err => {
  console.error("FATAL ERROR during server startup:", err);
});
