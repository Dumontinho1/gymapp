/* GymApp - biblioteca de exercícios. Os FREE_PER_GROUP primeiros de cada
   grupo (os mais comuns) são liberados no plano Free; o resto é Premium. */
window.GYMAPP_LIBRARY = {
  FREE_PER_GROUP: 5,
  groups: [
    { id:'peito', label:'Peito', icon:'🫁', exercises:[
      'Supino reto com barra', 'Supino inclinado com halteres', 'Crucifixo com halteres', 'Flexão de braço', 'Crossover na polia',
      'Supino declinado com barra', 'Supino reto com halteres', 'Supino inclinado com barra', 'Peck deck (voador)', 'Supino na máquina',
      'Crucifixo inclinado', 'Pullover com halter', 'Paralelas (mergulho) para peito', 'Crossover polia baixa'
    ]},
    { id:'costas', label:'Costas', icon:'🔙', exercises:[
      'Puxada frontal', 'Remada curvada com barra', 'Remada baixa sentada', 'Barra fixa', 'Remada unilateral com halter',
      'Puxada com triângulo', 'Remada cavalinho', 'Pulldown com braços estendidos', 'Levantamento terra', 'Remada na máquina',
      'Puxada atrás da nuca', 'Remada alta', 'Hiperextensão lombar', 'Barra fixa supinada'
    ]},
    { id:'ombros', label:'Ombros', icon:'🏔️', exercises:[
      'Desenvolvimento com halteres', 'Elevação lateral', 'Elevação frontal', 'Desenvolvimento militar com barra', 'Crucifixo invertido',
      'Desenvolvimento Arnold', 'Elevação lateral na polia', 'Face pull', 'Encolhimento com halteres', 'Desenvolvimento na máquina',
      'Crucifixo invertido na máquina', 'Encolhimento com barra', 'Remada alta com barra', 'Elevação lateral inclinado'
    ]},
    { id:'biceps', label:'Bíceps', icon:'💪', exercises:[
      'Rosca direta com barra', 'Rosca alternada com halteres', 'Rosca martelo', 'Rosca Scott', 'Rosca na polia',
      'Rosca concentrada', 'Rosca com barra W', 'Rosca inclinada com halteres', 'Rosca 21', 'Rosca inversa',
      'Rosca Scott unilateral', 'Rosca spider', 'Rosca martelo na corda'
    ]},
    { id:'triceps', label:'Tríceps', icon:'🦾', exercises:[
      'Tríceps na polia (pulley)', 'Tríceps testa', 'Tríceps corda', 'Tríceps francês', 'Mergulho no banco',
      'Tríceps coice com halter', 'Supino fechado', 'Tríceps unilateral na polia', 'Paralelas para tríceps', 'Tríceps na máquina',
      'Tríceps testa com halteres', 'Tríceps francês na polia', 'Flexão diamante'
    ]},
    { id:'quadriceps', label:'Quadríceps', icon:'🦵', exercises:[
      'Agachamento livre', 'Leg press 45°', 'Cadeira extensora', 'Afundo (avanço)', 'Agachamento no Smith',
      'Agachamento búlgaro', 'Hack squat', 'Agachamento frontal', 'Agachamento sumô', 'Passada andando',
      'Agachamento goblet', 'Leg press horizontal', 'Sissy squat', 'Step-up no banco'
    ]},
    { id:'posterior', label:'Posterior, glúteo e panturrilha', icon:'🍑', exercises:[
      'Mesa flexora', 'Stiff com barra', 'Elevação pélvica (hip thrust)', 'Cadeira flexora', 'Cadeira abdutora',
      'Levantamento terra romeno', 'Flexora em pé', 'Glúteo na polia (coice)', 'Ponte de glúteo', 'Good morning',
      'Cadeira adutora', 'Stiff com halteres', 'Glúteo 4 apoios', 'Panturrilha em pé', 'Panturrilha sentado'
    ]},
    { id:'abdomen', label:'Abdômen', icon:'🧱', exercises:[
      'Abdominal crunch', 'Prancha', 'Elevação de pernas', 'Abdominal bicicleta', 'Abdominal na polia',
      'Prancha lateral', 'Abdominal infra no banco', 'Roda abdominal', 'Elevação de pernas na barra', 'Abdominal oblíquo',
      'Russian twist', 'Abdominal remador', 'Dead bug', 'Mountain climber'
    ]}
  ]
};
