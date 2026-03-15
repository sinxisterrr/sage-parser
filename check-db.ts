import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  const result = await pool.query(`
    SELECT
      id,
      CASE
        WHEN content IS NULL THEN 'NULL'
        WHEN content = '' THEN 'EMPTY'
        ELSE 'HAS CONTENT'
      END as status,
      LENGTH(content) as len,
      category,
      importance,
      created_at
    FROM archival_memories
    ORDER BY created_at DESC
    LIMIT 10
  `);

  console.log('\n📊 Latest 10 entries in archival_memories:\n');
  console.table(result.rows);

  const nullCount = await pool.query(`
    SELECT COUNT(*) as count FROM archival_memories WHERE content IS NULL
  `);

  const totalCount = await pool.query(`
    SELECT COUNT(*) as count FROM archival_memories
  `);

  const withContent = Number(totalCount.rows[0].count) - Number(nullCount.rows[0].count);

  console.log(`\n📈 Statistics:`);
  console.log(`Total entries: ${totalCount.rows[0].count}`);
  console.log(`NULL content: ${nullCount.rows[0].count}`);
  console.log(`With content: ${withContent}`);

  await pool.end();
}

check();
