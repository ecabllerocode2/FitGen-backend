import fs from 'fs';
import path from 'path';
import { generarMesocicloCompleto } from '../api/mesocycle/generate.js';

async function run() {
  try {
    // Generar solamente el par solicitado: HOMBRE, Avanzado, 75kg, 1.70m, Hipertrofia, Tren_Superior, 4 días (Lun-Jue)
    const maleAdvProfile = {
      name: 'Comparative Male 35 4d - Advanced Hypertrophy Upper',
      age: 35,
      gender: 'Masculino',
      injuriesOrLimitations: 'Ninguna',
      heightCm: 170,
      initialWeight: 75, // BMI ~25.95 (normal)
      fitnessGoal: 'Hipertrofia',
      experienceLevel: 'Avanzado',
      focusArea: 'Tren_Superior',
      trainingDaysPerWeek: 4,
      preferredTrainingDays: ['Lunes', 'Martes', 'Miércoles', 'Jueves'],
      weeklyScheduleContext: [
        { day: 'Lunes', canTrain: true, externalLoad: 'none' },
        { day: 'Martes', canTrain: true, externalLoad: 'none' },
        { day: 'Miércoles', canTrain: true, externalLoad: 'none' },
        { day: 'Jueves', canTrain: true, externalLoad: 'none' },
        { day: 'Viernes', canTrain: false, externalLoad: 'light' },
        { day: 'Sábado', canTrain: false, externalLoad: 'heavy' },
        { day: 'Domingo', canTrain: false, externalLoad: 'heavy' }
      ],
      hasHomeEquipment: false,
      dateCompleted: new Date().toISOString()
    }; 

    // Usuario GYM
    const gymMaleAdv4 = {
      id: 'compare_user_male75_4d_gym_advanced_hypertrophy_upper',
      profileData: {
        ...maleAdvProfile,
        name: 'Male 35 4d - Gym - Advanced Hypertrophy Upper',
        preferredTrainingLocation: 'gym',
        hasHomeEquipment: false,
        homeEquipment: [],
        availableEquipment: ['Barbell', 'Dumbbells', 'Machines', 'Rack', 'Bench']
      }
    };

    // Usuario HOME
    const homeMaleAdv4 = {
      id: 'compare_user_male75_4d_home_advanced_hypertrophy_upper',
      profileData: {
        ...maleAdvProfile,
        name: 'Male 35 4d - Home - Advanced Hypertrophy Upper',
        preferredTrainingLocation: 'home',
        hasHomeEquipment: true,
        homeEquipment: ['Mancuernas 4-40kg', 'Bandas de Resistencia', 'Kettlebell'],
        availableEquipment: ['Peso Corporal', 'Mancuernas 4-40kg', 'Bandas de Resistencia', 'Kettlebell']
      }
    };

    // Generar mesociclos (solo estos dos)
    console.log('Generando mesociclo para usuario GYM (Male 35, Avanzado, Hipertrofia, Tren_Superior, 4 días)...');
    const mesoGymMale4 = generarMesocicloCompleto(gymMaleAdv4.profileData, null, null);

    console.log('Generando mesociclo para usuario HOME (Male 35, Avanzado, Hipertrofia, Tren_Superior, 4 días)...');
    const mesoHomeMale4 = generarMesocicloCompleto(homeMaleAdv4.profileData, null, null);

    // Guardar solo estos dos archivos de salida
    const outDir = path.join(process.cwd(), 'pruebas');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const timestamp = Date.now();
    const gymMale4File = path.join(outDir, `mesocycle_compare_gym_4days_male35_hypertrophy_upper_${timestamp}.json`);
    const homeMale4File = path.join(outDir, `mesocycle_compare_home_4days_male35_hypertrophy_upper_${timestamp}.json`);

    const outGymMale4 = {
      id: gymMaleAdv4.id,
      profile: gymMaleAdv4.profileData,
      generatedMesocycle: mesoGymMale4
    };

    const outHomeMale4 = {
      id: homeMaleAdv4.id,
      profile: homeMaleAdv4.profileData,
      generatedMesocycle: mesoHomeMale4
    };

    fs.writeFileSync(gymMale4File, JSON.stringify(outGymMale4, null, 2));
    fs.writeFileSync(homeMale4File, JSON.stringify(outHomeMale4, null, 2));

    console.log(`Archivos escritos:\n  - ${gymMale4File}\n  - ${homeMale4File}`);





  } catch (err) {
    console.error('Error generando mesociclos 4 días no consecutivos:', err);
    process.exit(1);
  }
}

run();
