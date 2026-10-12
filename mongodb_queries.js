// SmartMove MongoDB coursework queries (mongosh). Safe to run repeatedly.
const database = db.getSiblingDB(process.env.MONGODB_DATABASE || "smartmove");
for (const name of ["vehicle_multimedia", "passenger_reviews", "travel_announcements", "trip_multimedia"]) {
  if (!database.getCollectionNames().includes(name)) database.createCollection(name);
}

// Idempotent demonstration records: update the known demo record instead of duplicating it.
database.vehicle_multimedia.updateOne({vehicle_id:"V001"}, {$set:{vehicle_id:"V001",document_type:"Insurance Policy",file_url:"/uploads/docs/V001_insurance.pdf",multimedia_content:[{type:"image",caption:"Front Exterior",url:"/uploads/img/v001_front.jpg"},{type:"image",caption:"Interior Seating",url:"/uploads/img/v001_interior.jpg"}],uploaded_date:new Date()}}, {upsert:true});
database.passenger_reviews.updateOne({review_id:"REV001"}, {$set:{review_id:"REV001",route_id:"R001",trip_id:"T001",passenger_id:"U001",rating:5,driver_id:"D001",vehicle_id:"V001",comment:"Extremely smooth ride and very punctual driver. Clean bus interiors!",tags:["punctual","clean","smooth"],timestamp:new Date()}}, {upsert:true});
database.travel_announcements.updateOne({announcement_id:"A001"}, {$set:{announcement_id:"A001",title:"Holiday Schedule Update",content:"Check the latest trip schedule before travelling.",target_audience:"All Commuters",publish_date:new Date()}}, {upsert:true});
database.trip_multimedia.updateOne({media_id:"TM001"}, {$set:{media_id:"TM001",trip_id:"T001",type:"image",url:"/uploads/trips/T001.jpg",caption:"Sample trip media",created_at:new Date()}}, {upsert:true});

// 1. Reviews for a specific route
printjson(database.passenger_reviews.find({route_id:"R001"}).toArray());
// 2. Highest-rated vehicles and drivers
printjson(database.passenger_reviews.aggregate([{$group:{_id:"$vehicle_id",avgRating:{$avg:"$rating"},totalReviews:{$sum:1}}},{$sort:{avgRating:-1,totalReviews:-1}}]).toArray());
printjson(database.passenger_reviews.aggregate([{$group:{_id:"$driver_id",avgRating:{$avg:"$rating"},totalReviews:{$sum:1}}},{$sort:{avgRating:-1,totalReviews:-1}}]).toArray());
// 3. Keyword search for complaints/reviews
printjson(database.passenger_reviews.find({comment:{$regex:"smooth",$options:"i"}}).toArray());
// 4. Vehicle document/multimedia
printjson(database.vehicle_multimedia.findOne({vehicle_id:"V001"}));
// 5. Trip multimedia
printjson(database.trip_multimedia.find({trip_id:"T001"}).toArray());
