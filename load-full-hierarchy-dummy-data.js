const admin = require("firebase-admin");
const fs = require("fs");
const serviceAccount = require("./pecvs-testnet-firebase-adminsdk-fbsvc-2eba1548f1.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const MONTHS_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function getMonthCalendar(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDayJS = new Date(year, month - 1, 1).getDay();
  const firstDayMon = (firstDayJS + 6) % 7;
  const weeks = [];
  let week = [];
  let dow = firstDayMon;
  for (let d = 1; d <= daysInMonth; d++) {
    week.push({ dayName: DAYS[dow], date: d });
    if (dow === 6 || d === daysInMonth) { weeks.push(week); week = []; }
    dow = (dow + 1) % 7;
  }
  return weeks;
}

function validateDay(d) {
  if (d.P === 0 && d.E === 0 && d.C === 0 && d.V === 0 && d.S === 0 && d.prima === 0) return true;
  if (d.P < d.E) return false;
  if (d.E < d.C) return false;
  if (d.C < d.V) return false;
  if (d.S < d.V) return false;
  if (d.V === 0 && d.S > 0) return false;
  if (d.S > d.V * 2) return false;
  if (d.S > 0 && d.prima < 1) return false;
  return true;
}

function generateValidWeekData(weekNum, month, year, weekDays) {
  const dias = [];

  for (let dayData of weekDays) {
    const P = Math.floor(Math.random() * 15) + 10;
    const E = Math.floor(P * (0.70 + Math.random() * 0.20));
    const C = Math.floor(E * (0.70 + Math.random() * 0.20));
    const V = Math.floor(C * (0.50 + Math.random() * 0.40));
    const S = V > 0 ? Math.floor(V + Math.random() * V) : 0;
    const prima = V > 0 ? Math.floor(V * (1500 + Math.random() * 3000)) : 0;

    dias.push({ dia: dayData.dayName, P, E, C, V, S, prima });
  }

  const totales = dias.reduce((acc, d) => ({
    P: acc.P + d.P,
    E: acc.E + d.E,
    C: acc.C + d.C,
    V: acc.V + d.V,
    S: acc.S + d.S,
    prima: acc.prima + d.prima
  }), { P: 0, E: 0, C: 0, V: 0, S: 0, prima: 0 });

  return {
    agent: "agent",
    mes: `${MONTHS_ES[month - 1]} ${year}`,
    semana: String(weekNum),
    dias,
    totales,
    isIndividual: true
  };
}

async function generateAgentData(agentName) {
  const allEntries = [];

  for (let month = 1; month <= 12; month++) {
    const weeks = getMonthCalendar(2026, month);
    weeks.forEach((weekDays, weekIdx) => {
      const weekData = generateValidWeekData(weekIdx + 1, month, 2026, weekDays);
      weekData.agent = agentName;
      allEntries.push(weekData);
    });
  }

  return allEntries;
}

async function main() {
  try {
    console.log("📥 Generando estructura jerárquica completa...\n");

    // Estructura: 1 Director, 4 Promotores, 40 Coaches, 120+ Agentes
    const structure = {
      director: { email: "rtalertslive@gmail.com", name: "Franco Director" },
      promotores: [],
      coaches: [],
      agentes: []
    };

    // Crear 4 promotores
    for (let p = 1; p <= 4; p++) {
      structure.promotores.push({
        email: p === 1 ? "rtalertslive@gmail.com" : `promotor${p}@test.com`,
        name: p === 1 ? "Franco Promotor" : `Promotor ${p}`,
        promotorNum: p
      });
    }

    // Crear 40 coaches (asignar a promotores: 10 coaches por promotor)
    for (let c = 1; c <= 40; c++) {
      const promotorNum = Math.floor((c - 1) / 10) + 1;
      structure.coaches.push({
        email: c === 1 ? "rtalertslive@gmail.com" : `coach${c}@test.com`,
        name: c === 1 ? "Franco Coach" : `Coach ${c}`,
        coachNum: c,
        promotorNum,
        teamCode: `TEAM-COACH-${c}`
      });
    }

    // Crear 121 agentes (3 por coach, excepto Coach 1 que tiene Agente Franco)
    let agentNum = 0;
    for (let c = 1; c <= 40; c++) {
      for (let a = 0; a < 3; a++) {
        if (c === 1 && a === 0) {
          // Coach 1 primer agente es "Agente Franco"
          structure.agentes.push({
            email: "rtalertslive@gmail.com",
            name: "Agente Franco",
            agentNum: 0,
            coachNum: 1,
            teamCode: "TEAM-COACH-1"
          });
        } else {
          agentNum++;
          structure.agentes.push({
            email: `agente${agentNum}@test.com`,
            name: `Agente ${agentNum}`,
            agentNum,
            coachNum: c,
            teamCode: `TEAM-COACH-${c}`
          });
        }
      }
    }

    console.log(`✅ Estructura creada:`);
    console.log(`  📊 Director: 1`);
    console.log(`  📊 Promotores: ${structure.promotores.length}`);
    console.log(`  📊 Coaches: ${structure.coaches.length}`);
    console.log(`  📊 Agentes: ${structure.agentes.length}`);
    console.log(`\n💾 Generando datos dummy para ${structure.agentes.length} agentes...\n`);

    // Generar datos para cada agente y guardar en Firebase
    let savedCount = 0;

    for (let agente of structure.agentes) {
      const entries = await generateAgentData(agente.name);

      const agentData = {
        agentName: agente.name,
        email: agente.email,
        teamCode: agente.teamCode,
        coachNum: agente.coachNum,
        entries,
        type: "agent"
      };

      await db.collection("users").doc(agente.email).set(agentData, { merge: true });
      savedCount++;

      if (savedCount % 10 === 0) process.stdout.write(`\r  ✅ ${savedCount}/${structure.agentes.length} agentes guardados`);
    }
    console.log(`\r  ✅ ${savedCount}/${structure.agentes.length} agentes guardados\n`);

    // Guardar estructura de coaches en Firebase
    console.log(`💾 Guardando ${structure.coaches.length} coaches...\n`);
    for (let coach of structure.coaches) {
      const coachAgentes = structure.agentes.filter(a => a.coachNum === coach.coachNum);
      const coachData = {
        coachName: coach.name,
        email: coach.email,
        teamCode: coach.teamCode,
        promotorNum: coach.promotorNum,
        coachNum: coach.coachNum,
        agentes: coachAgentes.map(a => ({ email: a.email, name: a.name })),
        type: "coach"
      };

      await db.collection("coaches").doc(coach.email).set(coachData, { merge: true });
    }
    console.log(`✅ ${structure.coaches.length} coaches guardados\n`);

    // Guardar estructura de promotores
    console.log(`💾 Guardando ${structure.promotores.length} promotores...\n`);
    for (let promotor of structure.promotores) {
      const promotorCoaches = structure.coaches.filter(c => c.promotorNum === promotor.promotorNum);
      const promotorData = {
        promoterName: promotor.name,
        email: promotor.email,
        promotorNum: promotor.promotorNum,
        coaches: promotorCoaches.map(c => ({ email: c.email, name: c.name, coachNum: c.coachNum })),
        type: "promoter"
      };

      await db.collection("promoters").doc(promotor.email).set(promotorData, { merge: true });
    }
    console.log(`✅ ${structure.promotores.length} promotores guardados\n`);

    // Guardar estructura de director
    console.log(`💾 Guardando director...\n`);
    const directorData = {
      directorName: structure.director.name,
      email: structure.director.email,
      promoters: structure.promotores.map(p => ({ email: p.email, name: p.name, promotorNum: p.promotorNum })),
      type: "director"
    };

    await db.collection("directors").doc(structure.director.email).set(directorData, { merge: true });
    console.log(`✅ Director guardado\n`);

    console.log("═".repeat(50));
    console.log("✅ ¡ESTRUCTURA COMPLETA CARGADA!\n");
    console.log("📋 Resumen:");
    console.log(`  👤 Director: Franco Director (${structure.director.email})`);
    console.log(`  📊 Promotores: ${structure.promotores.length}`);
    console.log(`    - Franco Promotor (${structure.promotores[0].email}) - Promotor 1`);
    console.log(`    - Promotor 2-4: promotor2-4@test.com`);
    console.log(`  🏢 Coaches: ${structure.coaches.length}`);
    console.log(`    - Franco Coach (${structure.coaches[0].email}) - Coach 1`);
    console.log(`    - Coach 2-40: coach2-40@test.com`);
    console.log(`  👥 Agentes: ${structure.agentes.length}`);
    console.log(`    - Agente Franco (rtalertslive@gmail.com)`);
    console.log(`    - Agente 1-120: agente1-120@test.com`);
    console.log(`\n  Datos: Año 2026 completo (Enero - Diciembre)`);
    console.log(`  Entradas por agente: ${52} semanas (con variación según mes)`);
    console.log("═".repeat(50));

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

main();
