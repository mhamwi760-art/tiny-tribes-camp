/* ==========================================================
   Tiny Tribes – default site content
   These are the starting values. Anything changed in the
   dashboard is saved on top of these (see js/store.js).
   ========================================================== */

(function () {
  const G = "assets/img/gallery";

  function photos(id, count) {
    const list = [`${G}/covers/${id}.jpg`];
    for (let i = 1; i <= count; i++) list.push(`${G}/${id}/${id}-${i}.jpg`);
    return list;
  }

  window.TT_DEFAULTS = {
    version: 2,
    currency: "KWD",
    contact: {
      phone: "+965 60733303",
      instagram: "tinytribescamp",
      location: "Superkids Yarmouk, Kuwait"
    },

    programs: {
      winter: {
        name: "Winter Camp",
        open: true,
        dates: "Dec 20 – Dec 31",
        hours: "4:00 PM – 7:00 PM",
        days: "Sunday to Thursday",
        location: "Superkids Yarmouk, Kuwait",
        ages: ["2 years", "3 years", "4 years", "5–6 years", "7–8 years", "9–10 years"],
        options: [
          { id: "1-week", label: "1 Week", dates: "Week 1 · Dec 20 – 24", price: 80 },
          { id: "2-weeks", label: "2 Weeks", dates: "Dec 20 – 31", price: 140 }
        ]
      },
      summer: {
        name: "Summer Camp",
        open: false,
        dates: "",
        hours: "",
        days: "",
        location: "",
        ages: [],
        options: []
      }
    },

    categories: [
      { id: "field-trips", name: "Field Trips", photos: photos("field-trips", 9) },
      { id: "splash-day", name: "Splash Day", photos: photos("splash-day", 15) },
      { id: "carnival-day", name: "Carnival Day", photos: photos("carnival-day", 9) },
      { id: "cooking", name: "Cooking", photos: photos("cooking", 2) },
      { id: "sports", name: "Sports", photos: photos("sports", 9) },
      { id: "indoor", name: "Interactive Indoor Activities", photos: photos("indoor", 17) }
    ]
  };
})();
