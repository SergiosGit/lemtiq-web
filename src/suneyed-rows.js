function coerceTimestamp(value) {
  if (!value) {
    return null;
  }

  if (typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    return value;
  }

  return null;
}

function coerceNumber(value, fallback = null) {
  return Number.isFinite(value) ? value : fallback;
}

function coerceInteger(value, fallback = 0) {
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function timestampMillis(value) {
  const timestamp = coerceTimestamp(value);
  if (!timestamp) return Number.POSITIVE_INFINITY;
  const millis = new Date(timestamp).getTime();
  return Number.isNaN(millis) ? Number.POSITIVE_INFINITY : millis;
}

function sortEventsOldestFirst(events) {
  return [...events].sort((left, right) => timestampMillis(left.timestamp) - timestampMillis(right.timestamp));
}

function findLatestNumber(events, fieldName, fallback) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const value = coerceNumber(events[index][fieldName]);
    if (value !== null) return value;
  }
  return coerceNumber(fallback);
}

async function mapRows(rawRows, geocoder) {
  const rows = await Promise.all(
    rawRows.map(async (entry) => {
      const docId = entry.user_id || entry.id || entry.uid;
      const data = entry.data || entry;
      const events = sortEventsOldestFirst(Array.isArray(entry.events) ? entry.events : []);
      const firstLocationEvent = events.find((event) => (
        Number.isFinite(coerceNumber(event.lat)) && Number.isFinite(coerceNumber(event.lon))
      ));
      const locationSource = firstLocationEvent ? "event" : "user";
      const latitude = coerceNumber(firstLocationEvent?.lat, coerceNumber(data.latitude));
      const longitude = coerceNumber(firstLocationEvent?.lon, coerceNumber(data.longitude));
      const address = firstLocationEvent?.address || data.address
        || (Number.isFinite(latitude) && Number.isFinite(longitude)
          ? await geocoder.getAddress(latitude, longitude)
          : "Unknown address");

      return {
        user_id: docId,
        address,
        address_url: Number.isFinite(latitude) && Number.isFinite(longitude)
          ? `https://www.google.com/maps?q=${latitude},${longitude}`
          : null,
        app_version: data.app_version || "—",
        location_count: coerceInteger(data.location_count, 0),
        max_panel_group_count: coerceInteger(data.max_panel_group_count, 0),
        pdf_sent_count: coerceInteger(data.pdf_sent_count, 0),
        session_count: coerceInteger(data.session_count, 0),
        annual_savings: findLatestNumber(events, "annual_savings", data.annual_savings),
        break_even_years: findLatestNumber(events, "break_even_years", data.break_even_years),
        system_kw: coerceNumber(data.max_system_kw ?? data.system_kw),
        timestamp: coerceTimestamp(data.last_active) || coerceTimestamp(data.analysis_completed_at) || coerceTimestamp(data.created_at) || coerceTimestamp(data.timestamp),
        latitude,
        longitude,
        event_count: events.length,
        location_source: locationSource,
      };
    }),
  );

  rows.sort((left, right) => {
    const leftTime = left.timestamp ? new Date(left.timestamp).getTime() : 0;
    const rightTime = right.timestamp ? new Date(right.timestamp).getTime() : 0;
    return rightTime - leftTime;
  });

  return rows;
}


export { mapRows };
