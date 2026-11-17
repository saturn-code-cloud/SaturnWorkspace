import { supabaseJson } from "./supabase.js";

const ACCOUNT_STATES = ["active", "suspended", "pending_deletion", "deleted"];
const SUBSCRIPTION_STATES = ["none", "active", "history_only", "integrity_conflict"];
const SORTS = ["created_desc", "activity_desc", "name_asc"];

function boundedInteger(raw, fallback, max) {
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > max) throw new Error("invalid_user_directory_query");
  return Number(raw);
}

export async function listAdminUsers(params, env, signal) {
  const limit = boundedInteger(params.get("limit"), 50, 100);
  const page = boundedInteger(params.get("page"), 1, 5000);
  const search = (params.get("search") || "").trim();
  const exact = params.get("exact_email");
  const accountStatus = (params.get("account_status") || "").trim().toLowerCase();
  const verification = (params.get("verification") || "").trim().toLowerCase();
  const subscription = (params.get("subscription") || "").trim().toLowerCase();
  const sort = (params.get("sort") || "created_desc").trim().toLowerCase();
  if ((exact !== null && exact !== "true") || search.length > 254 || /[\u0000-\u001f\u007f]/.test(search) ||
      (exact && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(search) || page !== 1 || accountStatus || verification || subscription)) ||
      (accountStatus && !ACCOUNT_STATES.includes(accountStatus)) ||
      (verification && !["verified", "unverified"].includes(verification)) ||
      (subscription && !SUBSCRIPTION_STATES.includes(subscription)) || !SORTS.includes(sort)) {
    throw new Error("invalid_user_directory_query");
  }

  const exactEmail = exact ? search.toLowerCase() : null;
  let data;
  try {
    data = await supabaseJson(env, "/rpc/admin_user_directory", {
      method: "POST",
      signal,
      body: JSON.stringify({
        p_search: exactEmail || search,
        p_exact_email: Boolean(exactEmail),
        p_account_status: accountStatus,
        p_verification: verification,
        p_subscription: subscription,
        p_sort: sort,
        p_page: page,
        p_limit: limit,
      }),
    });
  } catch {
    throw new Error("admin_users_unavailable");
  }
  const { items, total } = data || {};
  if (!Array.isArray(items) || !Number.isSafeInteger(total) || total < 0 ||
      items.length !== Math.max(0, Math.min(limit, total - ((page - 1) * limit))) ||
      (exactEmail && (total > 1 || items.some((item) => item?.email !== exactEmail))) ||
      items.some((item) => !item || typeof item.firebase_uid !== "string" || !item.firebase_uid.trim() ||
        typeof item.email !== "string" || !item.email.trim() || !ACCOUNT_STATES.includes(item.account_status) ||
        !SUBSCRIPTION_STATES.includes(item.subscription_presence) ||
        !Number.isSafeInteger(item.session_count) || item.session_count < 0 ||
        !Number.isSafeInteger(item.device_count) || item.device_count < 0 ||
        (accountStatus && item.account_status !== accountStatus) ||
        (subscription && item.subscription_presence !== subscription)) ||
      new Set(items.map((item) => item.firebase_uid)).size !== items.length) {
    throw new Error("admin_users_unavailable");
  }
  return { success: true, directory_version: 1, items, total, page, limit, exact_email: exactEmail };
}
