/**
 * Career-page watcher. Hourly in Google's cloud: reads the public job boards listed in
 * config careerPages (Lever, Greenhouse, Ashby; meant to be read, no login) and adds new
 * matching roles to the Career pages tab as Needs you. It never applies.
 */

function boardJobs_(b) {
  const get = url => JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText() || '[]');
  if (b.ats === 'lever') {
    return get('https://api.lever.co/v0/postings/' + b.slug + '?mode=json').map(j => ({
      role: j.text, location: (j.categories && (j.categories.allLocations || [j.categories.location]).filter(String).join(', ')) || '',
      jobLink: j.hostedUrl, postedAt: j.createdAt ? new Date(j.createdAt) : '',
    }));
  }
  if (b.ats === 'greenhouse') {
    return (get('https://boards-api.greenhouse.io/v1/boards/' + b.slug + '/jobs').jobs || []).map(j => ({
      role: j.title, location: (j.location && j.location.name) || '', jobLink: j.absolute_url,
      postedAt: j.first_published ? new Date(j.first_published) : (j.updated_at ? new Date(j.updated_at) : ''),
    }));
  }
  if (b.ats === 'ashby') {
    return (get('https://api.ashbyhq.com/posting-api/job-board/' + b.slug).jobs || []).map(j => ({
      role: j.title, location: [j.location].concat((j.secondaryLocations || []).map(x => x.location)).concat(j.isRemote ? ['Remote'] : []).filter(String).join(', '),
      jobLink: j.jobUrl, postedAt: j.publishedAt ? new Date(j.publishedAt) : '',
    }));
  }
  return [];
}

function checkPages() {
  const counts = {}, errors = [];
  (CONFIG.careerPages.boards || []).forEach(b => {
    let jobs = [];
    try { jobs = boardJobs_(b); } catch (e) { errors.push(b.company + ': ' + e); return; }
    jobs.forEach(j => {
      const job = Object.assign(j, { company: b.company });
      // Several places in one listing: it fits if any of them is yours.
      const fit = fits_(Object.assign({}, job, { location: CONFIG.locations.some(l => job.location.toLowerCase().indexOf(l) >= 0) ? job.location : (job.location ? job.location : '') }));
      if (!fit.ok || !job.jobLink || hasJob_('Career pages', job.jobLink)) return;
      addJob('Career pages', Object.assign(job, {
        action: 'Needs you', status: 'Needs you', resume: 'None', note: 'None',
        notes: 'New on ' + b.company + "'s careers page (" + fit.track + '). To apply with your answers filled in, run on the Mac: npm run fill -- ' + job.jobLink,
      }));
      counts[b.company] = (counts[b.company] || 0) + 1;
    });
  });
  return { added: counts, errors: errors };
}
