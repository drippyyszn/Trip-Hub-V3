
// Mock Supabase client for offline functionality using LocalStorage
export const supabase = {
  from: (table: string) => ({
    select: (columns: string) => ({
      order: (column: string, { ascending }: { ascending: boolean }) => {
        try {
          const key = `triphub_db_${table}`;
          const stored = localStorage.getItem(key);
          let rows = stored ? JSON.parse(stored) : [];
          
          // Basic sort implementation
          rows.sort((a: any, b: any) => {
             const valA = a[column] || 0;
             const valB = b[column] || 0;
             return ascending ? valA - valB : valB - valA;
          });
          
          return Promise.resolve({ data: rows, error: null });
        } catch (e) {
          console.error("Mock DB Select Error", e);
          return Promise.resolve({ data: null, error: e });
        }
      }
    }),
    upsert: (row: any) => {
       try {
          const key = `triphub_db_${table}`;
          const stored = localStorage.getItem(key);
          let rows = stored ? JSON.parse(stored) : [];
          
          // Check for existing record by ID
          const idx = rows.findIndex((r: any) => r.id === row.id);
          
          if (idx > -1) {
            rows[idx] = row;
          } else {
            rows.push(row);
          }
          
          localStorage.setItem(key, JSON.stringify(rows));
          return Promise.resolve({ error: null });
       } catch (e) {
          console.error("Mock DB Upsert Error", e);
          return Promise.resolve({ error: e });
       }
    }
  })
};
