const DEFAULT_TIMEZONE = 'America/Mexico_City';

function calendarDayKey(dateInput, timezone = DEFAULT_TIMEZONE) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function trainedOnDay(lastWorkoutDate, timezone = DEFAULT_TIMEZONE, referenceDate = new Date()) {
  if (!lastWorkoutDate) return false;
  const sessionDay = calendarDayKey(lastWorkoutDate, timezone);
  const todayDay = calendarDayKey(referenceDate, timezone);
  return Boolean(sessionDay && todayDay && sessionDay === todayDay);
}

function trainedInLastDays(lastWorkoutDate, days, timezone = DEFAULT_TIMEZONE, referenceDate = new Date()) {
  if (!lastWorkoutDate) return false;
  const sessionMs = new Date(lastWorkoutDate).getTime();
  if (Number.isNaN(sessionMs)) return false;
  const refDay = calendarDayKey(referenceDate, timezone);
  if (!refDay) return false;

  for (let i = 0; i < days; i += 1) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() - i);
    if (calendarDayKey(d, timezone) === calendarDayKey(lastWorkoutDate, timezone)) {
      return true;
    }
  }
  return false;
}

export function buildAdminUsersOverview(users, referenceDate = new Date()) {
  const rows = users.map((user) => {
    const timezone = user.profileData?.timezone ?? DEFAULT_TIMEZONE;
    const gamification = user.gamification ?? {};
    const counters = gamification.counters ?? {};
    const lastWorkoutDate = user.lastWorkoutDate ?? null;

    return {
      uid: user.id,
      name: user.profileData?.name ?? user.name ?? 'Sin nombre',
      email: user.email ?? null,
      status: user.status ?? 'unknown',
      lastSessionAt: lastWorkoutDate,
      trainedToday: trainedOnDay(lastWorkoutDate, timezone, referenceDate),
      activeThisWeek: trainedInLastDays(lastWorkoutDate, 7, timezone, referenceDate),
      totalSessions: counters.lifetimeSessionsCompleted ?? 0,
      fitCoins: counters.fitCoinsBalance ?? 0,
      seasonPoints: counters.seasonPoints ?? 0,
      currentStreak: counters.currentStreakDays ?? 0,
      experienceLevel: user.profileData?.experienceLevel ?? null,
      createdAt: user.createdAt ?? null,
    };
  });

  rows.sort((a, b) => {
    const aTime = a.lastSessionAt ? new Date(a.lastSessionAt).getTime() : 0;
    const bTime = b.lastSessionAt ? new Date(b.lastSessionAt).getTime() : 0;
    return bTime - aTime;
  });

  const summary = {
    totalUsers: rows.length,
    activeToday: rows.filter((r) => r.trainedToday).length,
    activeThisWeek: rows.filter((r) => r.activeThisWeek).length,
    totalSessions: rows.reduce((sum, r) => sum + r.totalSessions, 0),
    pendingApproval: rows.filter((r) => r.status === 'pending_approval').length,
    approved: rows.filter((r) => r.status === 'approved').length,
    averageSessions: rows.length
      ? Math.round((rows.reduce((sum, r) => sum + r.totalSessions, 0) / rows.length) * 10) / 10
      : 0,
  };

  return { summary, users: rows };
}
