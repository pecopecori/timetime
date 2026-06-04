async function updateSlackStatus(token, text, emoji) {
  if (!token) return;
  try {
    await fetch('https://slack.com/api/users.profile.set', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        profile: { status_text: text, status_emoji: emoji, status_expiration: 0 },
      }),
    });
  } catch (_) {}
}

async function clearSlackStatus(token) {
  return updateSlackStatus(token, '', '');
}
